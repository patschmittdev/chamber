import { Blocks } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { McpServersTab } from './McpServersTab';
import { ToolsTab } from './ToolsTab';
import { SkillsTab } from './SkillsTab';
import { LensViewsTab } from './LensViewsTab';

export function ExtensionsView() {
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
              Manage the MCP servers, tools, skills, and Lens views that extend Chamber.
            </p>
          </div>
        </header>

        <Tabs defaultValue="mcp">
          <TabsList>
            <TabsTrigger value="mcp">MCP servers</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
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
          <TabsContent value="lens" className="mt-4">
            <LensViewsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
