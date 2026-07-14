import React, { useState, useEffect, useMemo } from 'react';
import { Camera, LogOut, UserRound } from 'lucide-react';
import type { MarketplaceRegistry, MindContext, UserProfile } from '@chamber/shared/types';
import { APP_VERSION } from '@/renderer/lib/appVersion';
import { useAppState, useAppDispatch } from '../../lib/store';
import { useInstructionPrecedence } from '../../hooks/useInstructionPrecedence';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { AddAccountModal } from './AddAccountModal';
import { AppearanceSettingsSection } from './AppearanceSettingsSection';
import { AgentsSettingsSection } from './AgentsSettingsSection';
import { PerMindCustomInstructionsControls } from './PerMindCustomInstructionsControls';
import { LocalLlmSettingsSection } from './LocalLlmSettingsSection';
import { Skeleton } from '../ui/skeleton';
import { VoiceDictationSettingsSection } from './VoiceDictationSettingsSection';
const ADD_ACCOUNT_VALUE = '__add-account__';
const SETTINGS_SECTION_TITLE_CLASS = 'text-xl font-semibold tracking-tight text-foreground';
const SETTINGS_SECTION_DESCRIPTION_CLASS = 'text-sm text-muted-foreground';
const SETTINGS_CARD_CLASS = 'rounded-xl border border-border bg-card p-5';
const SETTINGS_FIELD_LABEL_CLASS = 'text-xs font-medium text-muted-foreground';
const SETTINGS_FIELD_INPUT_CLASS = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20';
const SETTINGS_FIELD_TEXTAREA_CLASS = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20';
const PROFILE_ERROR = 'Could not update your profile. Try again.';
const INSTRUCTIONS_ERROR = 'Could not update custom instructions. Try again.';
const SOURCES_LOAD_ERROR = 'Could not load enrolled sources. Try again.';
const SOURCES_UPDATE_ERROR = 'Could not update enrolled sources. Try again.';

export function SettingsView() {
  const { activeMindId, featureFlags, minds } = useAppState();
  const dispatch = useAppDispatch();
  const [login, setLogin] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Array<{ login: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [marketplaces, setMarketplaces] = useState<MarketplaceRegistry[]>([]);
  const [marketplaceUrl, setMarketplaceUrl] = useState('');
  const [marketplaceMessage, setMarketplaceMessage] = useState<string | null>(null);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [addAccountIntent, setAddAccountIntent] = useState(0);
  const [profileName, setProfileName] = useState('');
  const [profileAbout, setProfileAbout] = useState('');
  const [profileLocation, setProfileLocation] = useState('');
  const [profileWork, setProfileWork] = useState('');
  const [profileAvatarDataUrl, setProfileAvatarDataUrl] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileImporting, setProfileImporting] = useState(false);
  const [customInstructions, setCustomInstructions] = useState('');
  const [customInstructionsMessage, setCustomInstructionsMessage] = useState<string | null>(null);
  const [customInstructionsSaving, setCustomInstructionsSaving] = useState(false);
  const sortedMinds = useMemo(
    () => [...minds].sort((a, b) => a.identity.name.localeCompare(b.identity.name)),
    [minds],
  );

  const {
    precedenceByMindId: instructionPrecedenceByMindId,
    savingMindId: instructionPreferenceSavingMindId,
    refresh: refreshInstructionPrecedence,
    setInheritance: setMindInstructionInheritance,
  } = useInstructionPrecedence(sortedMinds);

  useEffect(() => {
    let cancelled = false;
    const refreshAccountState = async () => {
      setError(false);
      const [status, availableAccounts] = await Promise.all([
        window.electronAPI.auth.getStatus(),
        window.electronAPI.auth.listAccounts(),
      ]);
      if (cancelled) return;
      setLogin(status.login ?? null);
      setAccounts([...availableAccounts].sort((a, b) => a.login.localeCompare(b.login)));
      setLoading(false);
    };

    refreshAccountState()
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    const unsubAccountSwitched = window.electronAPI.auth.onAccountSwitched(() => {
      void refreshAccountState().catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    });

    return () => {
      cancelled = true;
      unsubAccountSwitched();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.userProfile.get()
      .then((profile) => {
        if (!cancelled) applyUserProfile(profile);
      })
      .catch(() => {
        if (!cancelled) setProfileMessage(PROFILE_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshMarketplaces = async () => {
    setMarketplaces(await window.electronAPI.marketplace.listGenesisRegistries());
  };

  useEffect(() => {
    void refreshMarketplaces().catch(() => {
      setMarketplaceMessage(SOURCES_LOAD_ERROR);
    });
  }, []);

  const handleAccountChange = async (value: string) => {
    if (value === ADD_ACCOUNT_VALUE) {
      setAddAccountIntent((prev) => prev + 1);
      setAddAccountOpen(true);
      return;
    }

    if (value === login) return;

    const previousLogin = login;
    setLogin(value);
    try {
      await window.electronAPI.auth.switchAccount(value);
    } catch {
      setLogin(previousLogin);
    }
  };

  const handleRetryAddAccount = () => {
    void window.electronAPI.auth.cancelLogin?.().catch(() => {});
    setAddAccountIntent((prev) => prev + 1);
  };

  const applyUserProfile = (profile: UserProfile) => {
    setProfileName(profile.displayName);
    setProfileWork(profile.work);
    setProfileLocation(profile.location);
    setProfileAbout(profile.about);
    setProfileAvatarDataUrl(profile.avatarDataUrl);
    setCustomInstructions(profile.customInstructions ?? '');
  };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const profile = await window.electronAPI.userProfile.save({
        displayName: profileName,
        work: profileWork,
        location: profileLocation,
        about: profileAbout,
        avatarDataUrl: profileAvatarDataUrl,
      });
      applyUserProfile(profile);
      setProfileMessage('Profile saved.');
    } catch {
      setProfileMessage(PROFILE_ERROR);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveCustomInstructions = async () => {
    setCustomInstructionsSaving(true);
    setCustomInstructionsMessage(null);
    try {
      const profile = await window.electronAPI.userProfile.save({ customInstructions });
      setCustomInstructions(profile.customInstructions ?? '');
      await refreshInstructionPrecedence();
      setCustomInstructionsMessage('Custom instructions saved. New chats use them.');
    } catch {
      setCustomInstructionsMessage(INSTRUCTIONS_ERROR);
    } finally {
      setCustomInstructionsSaving(false);
    }
  };

  const handleToggleMindCustomInstructions = async (mind: MindContext, enabled: boolean) => {
    setCustomInstructionsMessage(null);
    try {
      await setMindInstructionInheritance(mind.mindId, enabled);
      setCustomInstructionsMessage(enabled
        ? `${mind.identity.name} now inherits global custom instructions.`
        : `${mind.identity.name} now skips global custom instructions.`);
    } catch {
      setCustomInstructionsMessage(INSTRUCTIONS_ERROR);
    }
  };

  const handleImportWorkProfile = async () => {
    setProfileImporting(true);
    setProfileMessage('Importing Microsoft 365 profile…');
    try {
      const result = await window.electronAPI.userProfile.importFromMicrosoft();
      if (!result.success) {
        setProfileMessage(result.cancelled ? 'Microsoft 365 profile import was cancelled.' : PROFILE_ERROR);
        return;
      }
      applyUserProfile(result.profile);
      setProfileMessage('Imported Microsoft 365 profile. You can edit the fields and save local changes.');
    } catch {
      setProfileMessage(PROFILE_ERROR);
    } finally {
      setProfileImporting(false);
    }
  };

  const handleAddMarketplace = async (event: React.FormEvent) => {
    event.preventDefault();
    setMarketplaceMessage(null);
    const result = await window.electronAPI.marketplace.addGenesisRegistry(marketplaceUrl);
    if (!result.success) {
      setMarketplaceMessage(SOURCES_UPDATE_ERROR);
      return;
    }
    setMarketplaceUrl('');
    setMarketplaceMessage(`Added ${result.registry.label}.`);
    await refreshMarketplaces();
  };

  const handleToggleMarketplace = async (registry: MarketplaceRegistry) => {
    const result = await window.electronAPI.marketplace.setGenesisRegistryEnabled(registry.id, !registry.enabled);
    if (!result.success) {
      setMarketplaceMessage(SOURCES_UPDATE_ERROR);
      return;
    }
    await refreshMarketplaces();
  };

  const handleRefreshMarketplace = async (registry: MarketplaceRegistry) => {
    const result = await window.electronAPI.marketplace.refreshGenesisRegistry(registry.id);
    setMarketplaceMessage(result.success ? `Refreshed ${result.registry.label}.` : SOURCES_UPDATE_ERROR);
  };

  const handleRemoveMarketplace = async (registry: MarketplaceRegistry) => {
    const result = await window.electronAPI.marketplace.removeGenesisRegistry(registry.id);
    if (!result.success) {
      setMarketplaceMessage(SOURCES_UPDATE_ERROR);
      return;
    }
    setMarketplaceMessage(`Removed ${result.registry.label}.`);
    await refreshMarketplaces();
  };

  return (
    <SettingsLayout
    >
      {(activeSection, agentsMindId, agentsSelectionToken, agentsInitialTab) => (
        <>
          {activeSection === 'profile' && (
            <section className="space-y-3">
              <header>
                <h2 className={SETTINGS_SECTION_TITLE_CLASS}>Profile</h2>
                <p className={SETTINGS_SECTION_DESCRIPTION_CLASS}>How Chamber addresses you and what your agents know about you.</p>
              </header>
              <div className={SETTINGS_CARD_CLASS}>
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    onClick={() => { void handleImportWorkProfile(); }}
                    disabled={profileImporting}
                    aria-label="Import profile photo from Microsoft 365"
                    className="group relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
                  >
                    {profileAvatarDataUrl ? (
                      <img src={profileAvatarDataUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <UserRound size={40} />
                    )}
                    <span className="absolute inset-0 flex items-end justify-center bg-black/55 pb-3 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Camera size={13} className="mr-1" />
                      Import
                    </span>
                  </button>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <label className={SETTINGS_FIELD_LABEL_CLASS} htmlFor="profile-name">
                        Name
                      </label>
                      <input
                        id="profile-name"
                        type="text"
                        value={profileName}
                        onChange={(event) => setProfileName(event.target.value)}
                        placeholder="How Chamber should address you"
                        className={SETTINGS_FIELD_INPUT_CLASS}
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={SETTINGS_FIELD_LABEL_CLASS} htmlFor="profile-work">
                          Work
                        </label>
                        <input
                          id="profile-work"
                          type="text"
                          value={profileWork}
                          onChange={(event) => setProfileWork(event.target.value)}
                          placeholder="Role, team, or company"
                          className={SETTINGS_FIELD_INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label className={SETTINGS_FIELD_LABEL_CLASS} htmlFor="profile-location">
                          Location
                        </label>
                        <input
                          id="profile-location"
                          type="text"
                          value={profileLocation}
                          onChange={(event) => setProfileLocation(event.target.value)}
                          placeholder="City, office, or timezone"
                          className={SETTINGS_FIELD_INPUT_CLASS}
                        />
                      </div>
                    </div>

                    <div>
                      <label className={SETTINGS_FIELD_LABEL_CLASS} htmlFor="profile-about">
                        About
                      </label>
                      <textarea
                        id="profile-about"
                        value={profileAbout}
                        onChange={(event) => setProfileAbout(event.target.value)}
                        placeholder="A little context your agents should know about you"
                        rows={3}
                        className={`${SETTINGS_FIELD_TEXTAREA_CLASS} resize-none`}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => { void handleImportWorkProfile(); }}
                        disabled={profileImporting}
                        title="Pulls name and photo from Microsoft Graph."
                        className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                      >
                        {profileImporting ? 'Importing…' : 'Import from work account'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleSaveProfile(); }}
                        disabled={profileSaving}
                        className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        {profileSaving ? 'Saving…' : 'Save profile'}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <strong className="font-medium text-foreground/80">Import</strong> pulls your name and photo from Microsoft Graph. <strong className="font-medium text-foreground/80">Save</strong> stores changes locally; nothing syncs back to your account.
                    </p>
                    {profileMessage ? (
                      <p role="status" className="text-xs text-muted-foreground">{profileMessage}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === 'custom-instructions' && (
            <section className="space-y-3">
              <header>
                <h2 className={SETTINGS_SECTION_TITLE_CLASS}>Custom instructions</h2>
                <p className={SETTINGS_SECTION_DESCRIPTION_CLASS}>Global guidance Chamber adds to every mind&apos;s system message, no matter which agent you chat with.</p>
              </header>
              <div className={`${SETTINGS_CARD_CLASS} space-y-3`}>
                <div>
                  <label className={SETTINGS_FIELD_LABEL_CLASS} htmlFor="custom-instructions">
                    Instructions for all minds
                  </label>
                  <textarea
                    id="custom-instructions"
                    value={customInstructions}
                    onChange={(event) => setCustomInstructions(event.target.value)}
                    placeholder="e.g. Keep answers concise. Prefer TypeScript examples. Ask before making large changes."
                    rows={8}
                    className={`${SETTINGS_FIELD_TEXTAREA_CLASS} resize-y`}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { void handleSaveCustomInstructions(); }}
                    disabled={customInstructionsSaving}
                    className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {customInstructionsSaving ? 'Saving…' : 'Save custom instructions'}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Applied to every mind on its next chat turn. Leave empty to add nothing to the system prompt. Stored locally with your profile.
                </p>
                <PerMindCustomInstructionsControls
                  minds={sortedMinds}
                  precedenceByMindId={instructionPrecedenceByMindId}
                  savingMindId={instructionPreferenceSavingMindId}
                  onToggle={handleToggleMindCustomInstructions}
                />
                {customInstructionsMessage ? (
                  <p role="status" className="text-xs text-muted-foreground">{customInstructionsMessage}</p>
                ) : null}
              </div>
            </section>
          )}

          {activeSection === 'agents' && (
            <AgentsSettingsSection
              minds={sortedMinds}
              initialSelectedMindId={agentsMindId}
              selectionToken={agentsSelectionToken}
              initialSelectedTab={agentsInitialTab}
              precedenceByMindId={instructionPrecedenceByMindId}
              savingMindId={instructionPreferenceSavingMindId}
              onToggleInheritance={handleToggleMindCustomInstructions}
            />
          )}

          {activeSection === 'account' && (
            <section className="space-y-3">
              <header>
                <h2 className={SETTINGS_SECTION_TITLE_CLASS}>Account</h2>
                <p className={SETTINGS_SECTION_DESCRIPTION_CLASS}>Which GitHub identity is signed in.</p>
              </header>
              <div className={SETTINGS_CARD_CLASS}>
                {loading ? (
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-2">
                      <Skeleton className="h-3.5 w-24" />
                      <Skeleton className="h-9 w-40" />
                    </div>
                  </div>
                ) : error ? (
                  <p className="text-sm text-destructive">Unable to load account info</p>
                ) : login || accounts.length > 0 ? (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Signed in as</p>
                      {accounts.length <= 1 ? (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium">
                            {login ?? '—'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setAddAccountIntent((prev) => prev + 1);
                              setAddAccountOpen(true);
                            }}
                            className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            + Add account
                          </button>
                        </div>
                      ) : (
                        <Select value={login ?? undefined} onValueChange={(value) => { void handleAccountChange(value); }}>
                          <SelectTrigger className="mt-2 min-w-56" aria-label="Select account">
                            <SelectValue placeholder="Select account" />
                          </SelectTrigger>
                          <SelectContent>
                            {accounts.map((account) => (
                              <SelectItem key={account.login} value={account.login}>
                                {account.login}
                              </SelectItem>
                            ))}
                            <SelectSeparator />
                            <SelectItem value={ADD_ACCOUNT_VALUE}>+ Add Account</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <button
                      onClick={() => window.electronAPI.auth.logout()}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <LogOut size={16} />
                      Log out
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Not signed in</p>
                )}
              </div>
            </section>
          )}

          {activeSection === 'models' && (
            <ModelsAndProvidersSection activeMindId={activeMindId} showLocalLlm={Boolean(featureFlags.byoLlm)} />
          )}

          {activeSection === 'sources-security' && (
            <section className="space-y-3">
              <header>
                <h2 className={SETTINGS_SECTION_TITLE_CLASS}>Sources &amp; security</h2>
                <p className={SETTINGS_SECTION_DESCRIPTION_CLASS}>
                  Manage enrolled marketplace sources and local voice permissions. Changes stay in this workspace.
                </p>
                <div className="mt-2">
                  <button
                    type="button"
                    className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => {
                      dispatch({ type: 'SET_PENDING_EXTENSIONS_INTENT', payload: { tab: 'skills' } });
                      dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'extensions' });
                    }}
                  >
                    Browse source offerings
                  </button>
                </div>
              </header>
              <div className={`${SETTINGS_CARD_CLASS} space-y-4`}>
                <div>
                  <h3 className="text-sm font-medium text-foreground">Enrolled marketplace sources</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    These sources provide Genesis templates and safe metadata for the Extensions directory.
                  </p>
                </div>
                <form className="flex gap-2" onSubmit={(event) => { void handleAddMarketplace(event); }}>
                  <input
                    type="url"
                    value={marketplaceUrl}
                    onChange={(event) => setMarketplaceUrl(event.target.value)}
                    placeholder="https://github.com/agency-microsoft/genesis-minds"
                    aria-label="Marketplace repository URL"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                  />
                  <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">
                    Add
                  </button>
                </form>

                {marketplaceMessage ? (
                  <p role="status" className="text-sm text-muted-foreground">{marketplaceMessage}</p>
                ) : null}

                <div className="space-y-3">
                  {marketplaces.map((registry) => (
                    <div key={registry.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{registry.label}</p>
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <span>{registry.enabled ? 'Enabled' : 'Disabled'}</span>
                            {registry.isDefault ? (
                              <>
                                <span aria-hidden>·</span>
                                <span
                                  title="The default marketplace supplies built-in templates and is used when a mind references a partial template id."
                                  className="rounded border border-border bg-muted/40 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                                >
                                  Default
                                </span>
                              </>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent" onClick={() => { void handleToggleMarketplace(registry); }}>
                            {registry.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent" onClick={() => { void handleRefreshMarketplace(registry); }}>
                            Refresh
                          </button>
                          {!registry.isDefault ? (
                            <button type="button" className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10" onClick={() => { void handleRemoveMarketplace(registry); }}>
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {featureFlags.voiceDictation ? (
                <div className="border-t border-border pt-6">
                  <VoiceDictationSettingsSection />
                </div>
              ) : null}
            </section>
          )}

          {activeSection === 'appearance' && (
            <AppearanceSettingsSection />
          )}

          <AddAccountModal
            open={addAccountOpen}
            openId={addAccountIntent}
            onClose={() => setAddAccountOpen(false)}
            onRetry={handleRetryAddAccount}
          />
        </>
      )}
    </SettingsLayout>
  );
}

// ---------------------------------------------------------------------------
// SettingsLayout
//
// Tabbed layout: left rail picks one section, the right pane shows just that
// section's content. Replaces the previous single-long-scroller layout with
// scroll-spy. Section swaps reuse the `view-enter` animation defined in
// index.css so navigating between sections matches the rest of the app.
// ---------------------------------------------------------------------------

export type SettingsSectionId = 'profile' | 'custom-instructions' | 'agents' | 'account' | 'appearance' | 'models' | 'sources-security';

interface SettingsRailItem {
  id: SettingsSectionId;
  label: string;
}

interface SettingsRailGroup {
  label: string;
  items: SettingsRailItem[];
}

interface SettingsLayoutProps {
  children: (activeSection: SettingsSectionId, agentsMindId?: string, agentsSelectionToken?: number, agentsInitialTab?: string) => React.ReactNode;
}

const LEGACY_SECTION_ALIASES: Readonly<Record<string, SettingsSectionId>> = {
  marketplaces: 'sources-security',
  'local-llm': 'models',
  'voice-dictation': 'sources-security',
};

function resolveSettingsSection(
  section: string | undefined,
  railItems: SettingsRailItem[],
): SettingsSectionId | undefined {
  if (!section) return undefined;
  const id = LEGACY_SECTION_ALIASES[section] ?? section;
  return railItems.find((item) => item.id === id)?.id;
}

function resolveInitialSection(
  intent: { section: string; mindId?: string; tab?: string } | null,
  railItems: SettingsRailItem[],
): SettingsSectionId {
  return resolveSettingsSection(intent?.section, railItems) ?? railItems[0]?.id ?? 'profile';
}

function SettingsLayout({ children }: SettingsLayoutProps) {
  const { pendingSettingsIntent } = useAppState();
  const dispatch = useAppDispatch();
  const railGroups = useMemo<SettingsRailGroup[]>(() => {
    const groups: SettingsRailGroup[] = [
      {
        label: 'Workspace',
        items: [
          { id: 'profile', label: 'Profile' },
          { id: 'account', label: 'Account' },
          { id: 'appearance', label: 'Appearance' },
        ],
      },
      {
        label: 'Agents',
        items: [
          { id: 'agents', label: 'Agents' },
          { id: 'custom-instructions', label: 'Custom instructions' },
        ],
      },
      {
        label: 'Models and providers',
        items: [{ id: 'models', label: 'Models and providers' }],
      },
      {
        label: 'Sources and security',
        items: [{ id: 'sources-security', label: 'Sources & security' }],
      },
    ];
    return groups;
  }, []);
  const railItems = useMemo(() => railGroups.flatMap((group) => group.items), [railGroups]);

  const [activeSection, setActiveSection] = useState<SettingsSectionId>(
    () => resolveInitialSection(pendingSettingsIntent, railItems),
  );
  const [deepLinkMindId, setDeepLinkMindId] = useState<string | undefined>(
    () => pendingSettingsIntent?.mindId,
  );
  // Distinguishes one deep-link from the next so a repeated intent to the same
  // agent is not collapsed into an unchanged prop (see AgentsSettingsSection).
  const [deepLinkToken, setDeepLinkToken] = useState(0);
  const [deepLinkTab, setDeepLinkTab] = useState<string | undefined>(
    () => pendingSettingsIntent?.tab,
  );

  // A caller (e.g. the agent sidebar "Manage agent" action) can deep-link into a
  // specific settings section and agent. Apply the one-shot intent, then clear it
  // so navigating away and back does not re-trigger it.
  useEffect(() => {
    if (!pendingSettingsIntent) return;
    const target = resolveSettingsSection(pendingSettingsIntent.section, railItems);
    if (target) setActiveSection(target);
    setDeepLinkMindId(pendingSettingsIntent.mindId);
    setDeepLinkTab(pendingSettingsIntent.tab);
    setDeepLinkToken((token) => token + 1);
    dispatch({ type: 'SET_PENDING_SETTINGS_INTENT', payload: null });
  }, [pendingSettingsIntent, railItems, dispatch]);

  // Feature flags may change after remote policy refresh. Keep the active page
  // on a section that is still available.
  useEffect(() => {
    if (!railItems.some((item) => item.id === activeSection)) {
      setActiveSection(railItems[0]?.id ?? 'profile');
    }
  }, [activeSection, railItems]);

  const activeSectionLabel = railItems.find((item) => item.id === activeSection)?.label ?? 'Settings';

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label="Settings sections"
        className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-card/20 px-3 py-5"
      >
        <div className="px-2 pb-3">
          <p className="text-lg font-semibold tracking-tight text-foreground">Settings</p>
        </div>
        {railGroups.map((group) => (
          <section key={group.label} aria-labelledby={`settings-group-${group.label.replaceAll(' ', '-').toLowerCase()}`} className="space-y-1">
            <h2 id={`settings-group-${group.label.replaceAll(' ', '-').toLowerCase()}`} className="px-2 pt-2 text-xs font-semibold text-muted-foreground">
              {group.label}
            </h2>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                aria-current={activeSection === item.id ? 'page' : undefined}
                className={
                  'relative w-full rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '
                  + 'before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-px before:bg-primary before:transition-all before:duration-200 '
                  + (activeSection === item.id
                    ? 'bg-selected text-foreground font-medium before:h-4 before:opacity-100'
                    : 'text-muted-foreground hover:bg-hover hover:text-foreground before:h-0 before:opacity-0')
                }
              >
                {item.label}
              </button>
            ))}
          </section>
        ))}
        <div className="mt-auto pt-4 px-2 text-xs text-muted-foreground">
          Chamber v{APP_VERSION}
        </div>
      </nav>
      <div className="flex-1 overflow-y-auto">
        {/* Keying on activeSection restarts the `view-enter` animation
         * (defined in index.css) every time the user picks a new tab,
         * matching the activity-bar transitions. */}
        <div key={activeSection} className="view-enter mx-auto w-full max-w-4xl space-y-6 p-6 md:p-8">
          <header className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h2>
            <p className="text-sm text-muted-foreground">{activeSectionLabel}</p>
          </header>
          {children(activeSection, deepLinkMindId, deepLinkToken, deepLinkTab)}
        </div>
      </div>
    </div>
  );
}

function ModelsAndProvidersSection({
  activeMindId,
  showLocalLlm,
}: {
  activeMindId: string | null;
  showLocalLlm: boolean;
}) {
  const dispatch = useAppDispatch();
  return (
    <section className="space-y-4">
      <header>
        <h2 className={SETTINGS_SECTION_TITLE_CLASS}>Models &amp; providers</h2>
        <p className={SETTINGS_SECTION_DESCRIPTION_CLASS}>
          Provider settings are saved locally. Each agent keeps its own model selection.
        </p>
      </header>
      <div className={SETTINGS_CARD_CLASS}>
        <h3 className="text-sm font-medium text-foreground">Per-agent model selection</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the model an agent uses for new turns from its configuration. This does not change other agents.
        </p>
        <button
          type="button"
          className="mt-3 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            dispatch({ type: 'SET_PENDING_SETTINGS_INTENT', payload: { section: 'agents', ...(activeMindId ? { mindId: activeMindId } : {}), tab: 'model' } });
          }}
        >
          Configure agent model
        </button>
      </div>
      {showLocalLlm ? <LocalLlmSettingsSection /> : (
        <div className={`${SETTINGS_CARD_CLASS} text-sm text-muted-foreground`}>
          Local and custom providers are not enabled for this workspace.
        </div>
      )}
    </section>
  );
}
