# Cross-Surface Quality Gate Matrix

This matrix identifies deterministic regression coverage for the capability
workspaces and desktop shell. It intentionally separates environment-dependent
smokes from the required local gate.

| Critical flow | Automated coverage | Classification |
| --- | --- | --- |
| Installed capability inventory, availability filters, and global versus active-mind scope | `ExtensionsView.test.tsx` | Required renderer regression |
| Curated directory search, installed-versus-directory separation, redacted detail, and safe install preflight | `CuratedDirectory.test.tsx` | Required renderer regression |
| Connector configuration status, remediation, and bounded feedback | `McpServersTab.test.tsx` | Required renderer regression |
| Skills and Prompts authoring, saving, and unsaved-edit navigation | `SkillsTab.test.tsx`, `PromptsTab.test.tsx`, `prompt-library-smoke.spec.ts` | Required renderer plus Electron regression |
| Lens sample framing, Canvas in-frame action, inherited light/dark appearance, and fixed appearance | `lens-hotload.spec.ts` | Required Electron regression |
| Extension and Settings keyboard navigation, active-mind scope context, and keyboard rail resizing | `cross-surface-quality-gate.spec.ts`, `useResizableRail.test.ts` | Required Electron plus renderer regression |
| Settings task groups and marketplace-source context | `SettingsView.test.tsx`, `cross-surface-quality-gate.spec.ts` | Required renderer plus Electron regression |
| Marketplace add, refresh, and removal against a private source | `settings-marketplace-management.spec.ts` | Credential-gated environment smoke |
| Managed-skill installation from the public marketplace | `marketplace-managed-skills.spec.ts` | Network-dependent environment smoke |
| Marketplace tool reconciliation | `tools-reconcile-smoke.spec.ts` | Opt-in network and global npm environment smoke |
| MindProfileService symlink checks on Windows | Existing service tests | Windows symlink privilege baseline. Do not weaken or change the security assertions when EPERM prevents symlink creation. |

The required gate does not assert animation timing, incidental CSS, raw
configuration, credentials, filesystem paths, or marketplace source bodies.
