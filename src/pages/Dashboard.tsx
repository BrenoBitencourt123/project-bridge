import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Settings, LogOut, Plus, ImageIcon, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Project, STATUS_CONFIG } from '@/types/atlas';
import { useToast } from '@/hooks/use-toast';

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [pasteScript, setPasteScript] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [generatingScript, setGeneratingScript] = useState(false);
  const [thumbnailDialog, setThumbnailDialog] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });
  const [thumbnailPrompt, setThumbnailPrompt] = useState('');
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });

  const createProject = useMutation({
    mutationFn: async ({ title, raw_script }: { title: string; raw_script: string }) => {
      const { data, error } = await supabase
        .from('projects')
        .insert({ user_id: user!.id, title, raw_script, status: 'scripted' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setNewProjectOpen(false);
      setPasteScript('');
      setAiPrompt('');
      navigate(`/project/${data.id}`);
    },
    onError: (err: any) => toast({ title: 'Erro ao criar projeto', description: err.message, variant: 'destructive' }),
  });

  const handlePasteCreate = () => {
    if (!pasteScript.trim()) return;
    const title = pasteScript.trim().split(/\s+/).slice(0, 6).join(' ');
    createProject.mutate({ title, raw_script: pasteScript });
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setGeneratingScript(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-script', {
        body: { freePrompt: aiPrompt },
      });
      if (error) throw error;
      const title = data.script.trim().split(/\s+/).slice(0, 6).join(' ');
      createProject.mutate({ title, raw_script: data.script });
    } catch (err: any) {
      toast({ title: 'Erro ao gerar roteiro', description: err.message, variant: 'destructive' });
    } finally {
      setGeneratingScript(false);
    }
  };

  const handleGenerateThumbnail = async () => {
    if (!thumbnailDialog.project || !thumbnailPrompt.trim()) return;
    setGeneratingThumbnail(true);
    try {
      const { error } = await supabase.functions.invoke('generate-thumbnail', {
        body: {
          projectId: thumbnailDialog.project.id,
          projectTitle: thumbnailDialog.project.title,
          userPrompt: thumbnailPrompt,
        },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setThumbnailDialog({ open: false, project: null });
      setThumbnailPrompt('');
      toast({ title: 'Thumbnail gerada!' });
    } catch (err: any) {
      toast({ title: 'Erro ao gerar thumbnail', description: err.message, variant: 'destructive' });
    } finally {
      setGeneratingThumbnail(false);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">Atlas Studio</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
              <Settings className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={signOut}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold">Projetos</h1>
            <p className="text-sm text-muted-foreground">Seus vídeos educacionais para o ENEM</p>
          </div>
          <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4" /> Novo Projeto</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Novo Projeto</DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="paste">
                <TabsList className="w-full">
                  <TabsTrigger value="paste" className="flex-1">Colar roteiro</TabsTrigger>
                  <TabsTrigger value="ai" className="flex-1">Gerar com IA</TabsTrigger>
                </TabsList>
                <TabsContent value="paste" className="space-y-4 pt-4">
                  <Textarea placeholder="Cole seu roteiro aqui..." value={pasteScript} onChange={e => setPasteScript(e.target.value)} rows={8} />
                  <Button className="w-full" onClick={handlePasteCreate} disabled={!pasteScript.trim() || createProject.isPending}>
                    {createProject.isPending && <Loader2 className="animate-spin" />}
                    Criar projeto
                  </Button>
                </TabsContent>
                <TabsContent value="ai" className="space-y-4 pt-4">
                  <Textarea placeholder="Descreva o vídeo que deseja criar..." value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={4} />
                  <Button className="w-full" onClick={handleAiGenerate} disabled={!aiPrompt.trim() || generatingScript}>
                    {generatingScript && <Loader2 className="animate-spin" />}
                    <Sparkles className="h-4 w-4" /> Gerar Roteiro
                  </Button>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">Nenhum projeto ainda. Crie o primeiro!</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map(project => {
              const statusCfg = STATUS_CONFIG[project.status];
              return (
                <Card key={project.id} className="group cursor-pointer overflow-hidden transition-colors hover:border-primary/40" onClick={() => navigate(`/project/${project.id}`)}>
                  <div className="aspect-video bg-muted/50 relative overflow-hidden">
                    {project.thumbnail_url ? (
                      <img src={project.thumbnail_url} alt={project.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
                      </div>
                    )}
                    <Badge className={`absolute right-2 top-2 ${statusCfg.color}`}>{statusCfg.label}</Badge>
                  </div>
                  <CardContent className="p-4">
                    <h3 className="mb-1 font-semibold truncate">{project.title}</h3>
                    <p className="mb-2 text-xs text-muted-foreground line-clamp-2">
                      {project.raw_script?.slice(0, 100) || [project.subject, project.topic].filter(Boolean).join(' · ') || 'Sem descrição'}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{new Date(project.updated_at).toLocaleDateString('pt-BR')} · {project.target_duration || 10}min</span>
                      <Button variant="ghost" size="sm" className="h-7 text-xs opacity-0 group-hover:opacity-100" onClick={e => { e.stopPropagation(); setThumbnailDialog({ open: true, project }); }}>
                        <Sparkles className="h-3 w-3" /> Thumbnail
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Thumbnail Dialog */}
      <Dialog open={thumbnailDialog.open} onOpenChange={open => setThumbnailDialog({ open, project: open ? thumbnailDialog.project : null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar Thumbnail</DialogTitle>
          </DialogHeader>
          {thumbnailDialog.project && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Projeto: {thumbnailDialog.project.title}</p>
              <Input placeholder="Descreva a thumbnail..." value={thumbnailPrompt} onChange={e => setThumbnailPrompt(e.target.value)} />
              <Button className="w-full" onClick={handleGenerateThumbnail} disabled={!thumbnailPrompt.trim() || generatingThumbnail}>
                {generatingThumbnail && <Loader2 className="animate-spin" />}
                Gerar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
