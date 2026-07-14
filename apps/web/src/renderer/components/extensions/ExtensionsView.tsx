import { useEffect, useState } from 'react';
import { Blocks } from 'lucide-react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { McpServersTab } from './McpServersTab';
import { ToolsTab } from './ToolsTab';
import { SkillsTab } from './SkillsTab';
import { PromptsTab } from './PromptsTab';
import { LensViewsTab } from './LensViewsTab';

export function ExtensionsView() {
  const { pendingExtensionsIntent } = useAppState();
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState('mcp');
  const [intentElapsedSeconds, setIntentElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!pendingExtensionsIntent) return;
    setActiveTab(pendingExtensionsIntent.tab);
    // A follow-up action (e.g. create-skill) is cleared by the destination tab
    // once it applies it; clear here only for a plain tab deep-link so the intent
    // does not linger and re-pin the tab on a later navigation.
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

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        <header className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3 text-primary">
            <Blocks size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Extensions</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Manage the MCP servers, tools, skills, prompts, and Lens views that extend Chamber.
            </p>
            {pendingExtensionsIntent?.action ? (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                Applying shortcut action... {intentElapsedLabel}
              </p>
            ) : null}
          </div>
        </header>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value);
            if (pendingExtensionsIntent) {
              dispatch({ type: 'SET_PENDING_EXTENSIONS_INTENT', payload: null });
            }
          }}
        >
          <TabsList>
            <TabsTrigger value="mcp">MCP servers</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
            <TabsTrigger value="lens">Lens views</TabsTrigger>
          </TabsList>

          <TabsContent value="mcp" className="mt-4">
            <McpServersTab />
          </TabsContent>
          <TabsContent value="tools" className="mt-4">
            <ToolsTab />
          </TabsContent>
          <TabsContent value="skills" className="mt-4">
            <SkillsTab />
          </TabsContent>
          <TabsContent value="prompts" className="mt-4">
            <PromptsTab />
          </TabsContent>
          <TabsContent value="lens" className="mt-4">
            <LensViewsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
