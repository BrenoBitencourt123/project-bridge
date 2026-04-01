import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ImageIcon, Sparkles, Loader2, Trash2, Video, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Project, STATUS_CONFIG } from '@/types/atlas';
import { useToast } from '@/hooks/use-toast';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [creatingProject, setCreatingProject] = useState(false);
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

  const handleNewProject = async () => {
    setCreatingProject(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({ user_id: user!.id, title: 'Novo Projeto', status: 'draft' })
        .select()
        .single();
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/project/${(data as any).id}`);
    } catch (err: any) {
      toast({ title: 'Erro ao criar projeto', description: err.message, variant: 'destructive' });
    } finally {
      setCreatingProject(false);
    }
  };

  const deleteProject = useMutation({
    mutationFn: async (projectId: string) => {
      // Clean storage files
      const buckets = ['segment-images', 'segment-audio'];
      for (const bucket of buckets) {
        const { data: files } = await supabase.storage.from(bucket).list(projectId);
        if (files && files.length > 0) {
          await supabase.storage.from(bucket).remove(files.map(f => `${projectId}/${f.name}`));
        }
      }
      const { error } = await supabase.from('projects').delete().eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast({ title: 'Projeto excluído' });
    },
    onError: (err: any) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

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

  const totalProjects = projects.length;
  const completedProjects = projects.filter(p => p.status === 'complete').length;
  const inProgressProjects = projects.filter(p => p.status !== 'complete' && p.status !== 'draft').length;

  return (
    <div className="min-h-full p-6 space-y-6">
      {/* Métricas */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Video className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total de projetos</p>
            <p className="text-2xl font-bold">{totalProjects}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-success/10 p-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Completos</p>
            <p className="text-2xl font-bold">{completedProjects}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-warning/10 p-2">
            <Clock className="h-5 w-5 text-warning" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Em produção</p>
            <p className="text-2xl font-bold">{inProgressProjects}</p>
          </div>
        </Card>
      </div>

      {/* Projetos */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold">Projetos</h1>
          <p className="text-sm text-muted-foreground">Seus vídeos em produção</p>
        </div>
        <Button onClick={handleNewProject} disabled={creatingProject}>
          {creatingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Novo Projeto
        </Button>
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
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={e => { e.stopPropagation(); setThumbnailDialog({ open: true, project }); }}>
                          <Sparkles className="h-3 w-3" /> Thumb
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={e => e.stopPropagation()}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={e => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
                              <AlertDialogDescription>
                                "{project.title}" e todos os seus dados (segmentos, imagens, áudios) serão removidos permanentemente.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteProject.mutate(project.id)}>Excluir</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

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

