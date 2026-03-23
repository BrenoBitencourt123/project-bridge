import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Project, Segment, SubScene, getMaxStep } from '@/types/atlas';
import { StepperHeader } from '@/components/pipeline/StepperHeader';
import { ScriptStep } from '@/components/pipeline/ScriptStep';
import { SegmentsStep } from '@/components/pipeline/SegmentsStep';
import { MediaStep } from '@/components/pipeline/MediaStep';
import { ExportStep } from '@/components/pipeline/ExportStep';

export default function ProjectPipeline() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [localProject, setLocalProject] = useState<Project | null>(null);
  const [localSegments, setLocalSegments] = useState<Segment[]>([]);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Project;
    },
  });

  const { data: segments = [] } = useQuery({
    queryKey: ['segments', id],
    queryFn: async () => {
      // Fetch segments
      const { data: segs, error } = await supabase
        .from('segments')
        .select('*')
        .eq('project_id', id!)
        .order('sequence_number');
      if (error) throw error;

      if (!segs || segs.length === 0) return [] as Segment[];

      // Fetch sub_scenes for all segments
      const segmentIds = segs.map(s => s.id);
      const { data: subScenes, error: subErr } = await supabase
        .from('sub_scenes')
        .select('*')
        .in('segment_id', segmentIds)
        .order('sub_index');

      if (subErr) console.error('Error loading sub_scenes:', subErr);

      // Attach sub_scenes to segments
      return segs.map(seg => ({
        ...seg,
        sub_scenes: (subScenes || [])
          .filter((sc: any) => sc.segment_id === seg.id)
          .sort((a: any, b: any) => a.sub_index - b.sub_index) as SubScene[],
      })) as Segment[];
    },
  });

  useEffect(() => {
    if (project) {
      setLocalProject(project);
      setTitleDraft(project.title);
      setCurrentStep(Math.min(currentStep, getMaxStep(project.status)));
    }
  }, [project]);

  useEffect(() => {
    if (segments.length > 0) setLocalSegments(segments);
  }, [segments]);

  const handleTitleSave = async () => {
    if (!localProject || !titleDraft.trim()) return;
    setEditingTitle(false);
    await supabase.from('projects').update({ title: titleDraft.trim(), updated_at: new Date().toISOString() }).eq('id', localProject.id);
    setLocalProject({ ...localProject, title: titleDraft.trim() });
  };

  const updateProject = (updates: Partial<Project>) => {
    if (localProject) setLocalProject({ ...localProject, ...updates });
  };

  if (isLoading || !localProject) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const maxStep = getMaxStep(localProject.status);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          {editingTitle ? (
            <Input
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={e => e.key === 'Enter' && handleTitleSave()}
              className="text-lg font-semibold h-auto py-1"
            />
          ) : (
            <h1 className="text-lg font-semibold cursor-pointer truncate hover:text-primary" onClick={() => setEditingTitle(true)}>
              {localProject.title}
            </h1>
          )}
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3">
          <StepperHeader currentStep={currentStep} maxStep={maxStep} onStepChange={setCurrentStep} />
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        {currentStep === 0 && (
          <ScriptStep project={localProject} onUpdate={updateProject} onNext={() => setCurrentStep(1)} />
        )}
        {currentStep === 1 && (
          <SegmentsStep project={localProject} segments={localSegments} onSegmentsChange={setLocalSegments} onUpdate={updateProject} onNext={() => setCurrentStep(2)} />
        )}
        {currentStep === 2 && (
          <MediaStep project={localProject} segments={localSegments} onSegmentsChange={setLocalSegments} onUpdate={updateProject} onNext={() => setCurrentStep(3)} />
        )}
        {currentStep === 3 && (
          <ExportStep projectTitle={localProject.title} segments={localSegments} />
        )}
      </main>
    </div>
  );
}
