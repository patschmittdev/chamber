import { useEffect, useState } from 'react';
import { Blocks, ChevronDown } from 'lucide-react';
import { useAppState, useAppDispatch } from '../../lib/store';
import type { ExtensionsTab } from '../../lib/store/state';
import { Button } from '../ui/button';
import { Tabs, TabsContent } from '../ui/tabs';
import {
  CapabilityCategoryNavigation,
  CapabilityInventoryPanel,
  EXTENSION_CATEGORIES,
  categoryForTab,
  useCapabilityInventory,
} from './CapabilityInventory';
import { McpServersTab } from './McpServersTab';
import { ToolsTab } from './ToolsTab';
import { SkillsTab } from './SkillsTab';
import { PromptsTab } from './PromptsTab';
import { LensViewsTab } from './LensViewsTab';

export function ExtensionsView() {
  const { activeMindId, pendingExtensionsIntent } = useAppState();
  const dispatch = useAppDispatch();
  const inventory = useCapabilityInventory(activeMindId);
  const [activeTab, setActiveTab] = useState<ExtensionsTab>('skills');
  const [managementTab, setManagementTab] = useState<ExtensionsTab | null>(null);
  const [intentElapsedSeconds, setIntentElapsedSeconds] = useState(0);
  const category = categoryForTab(activeTab);

  useEffect(() => {
    if (!pendingExtensionsIntent) return;
    setActiveTab(pendingExtensionsIntent.tab);
    setManagementTab(pendingExtensionsIntent.action ? pendingExtensionsIntent.tab : null);
    // A follow-up action (for example, creating a skill) is cleared by the
    // destination tab after it mounts. Plain navigation intents end here.
    if (!pendingExtensionsIntent.action) {
      dispatch({ type: 'SET_PENDING_EXTENSIONS_INTENT', payload: null });
    }
  }, [pendingExtensionsIntent, dispatch]);

  useEffect(() => {
    if (!pendingExtensionsIntent?.action) {
      setIntentElapsedSeconds(0);
      return;
    }
    const timer = window.setInterval(() => {
      setIntentElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pendingExtensionsIntent?.action]);

  const intentElapsedLabel = `${Math.floor(intentElapsedSeconds / 60)}:${String(intentElapsedSeconds % 60).padStart(2, '0')}`;
  const managing = managementTab === activeTab;

  const selectCategory = (tab: ExtensionsTab) => {
    setActiveTab(tab);
    setManagementTab(null);
    if (pendingExtensionsIntent) {
      dispatch({ type: 'SET_PENDING_EXTENSIONS_INTENT', payload: null });
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
        <header className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3 text-primary">
            <Blocks size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Extensions</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Installed capabilities for {activeMindId ? 'the active mind and global workspace' : 'the global workspace'}.
            </p>
            {pendingExtensionsIntent?.action ? (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                Applying shortcut action... {intentElapsedLabel}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  dispatch({ type: 'SET_PENDING_SETTINGS_INTENT', payload: { section: 'marketplaces' } });
                  dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'settings' });
                }}
              >
                Manage marketplaces
              </Button>
            </div>
          </div>
        </header>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            const category = EXTENSION_CATEGORIES.find((entry) => entry.tab === value);
            if (category) selectCategory(category.tab);
          }}
        >
          <CapabilityCategoryNavigation items={inventory.result.items} />
          <TabsContent value={activeTab} className="mt-4 flex flex-col gap-6">
            <CapabilityInventoryPanel activeTab={activeTab} inventory={inventory} />

            <section className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <h2 className="font-semibold">Manage {category.label}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Use the existing {category.label.toLowerCase()} controls when you need to make a change.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-expanded={managing}
                  aria-controls={`extension-management-${activeTab}`}
                  onClick={() => setManagementTab(managing ? null : activeTab)}
                >
                  {managing ? 'Hide management' : `Manage ${category.label.toLowerCase()}`}
                  <ChevronDown size={16} className={managing ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </Button>
              </div>
              {managing ? (
                <div id={`extension-management-${activeTab}`} className="border-t border-border p-4">
                  <CategoryManagement tab={activeTab} onInventoryChanged={inventory.reload} />
                </div>
              ) : null}
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function CategoryManagement({ tab, onInventoryChanged }: { readonly tab: ExtensionsTab; readonly onInventoryChanged: () => void }) {
  switch (tab) {
    case 'skills':
      return <SkillsTab onInventoryChanged={onInventoryChanged} />;
    case 'mcp':
      return <McpServersTab onInventoryChanged={onInventoryChanged} />;
    case 'tools':
      return <ToolsTab onInventoryChanged={onInventoryChanged} />;
    case 'prompts':
      return <PromptsTab onInventoryChanged={onInventoryChanged} />;
    case 'lens':
      return <LensViewsTab onInventoryChanged={onInventoryChanged} />;
  }
}
