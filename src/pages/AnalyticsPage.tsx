import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, Film, Image, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  scripted: 'Roteiro',
  segmented: 'Segmentado',
  images_done: 'Imagens',
  audio_done: 'Áudio',
  complete: 'Completo',
};

const COLORS = ['hsl(217, 91%, 60%)', 'hsl(32, 95%, 44%)', 'hsl(142, 71%, 45%)', 'hsl(0, 72%, 51%)', 'hsl(270, 60%, 55%)', 'hsl(190, 80%, 45%)'];

export default function AnalyticsPage() {
  const navigate = useNavigate();

  const { data: projects = [] } = useQuery({
    queryKey: ['analytics-projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, status, created_at');
      if (error) throw error;
      return data;
    },
  });

  const { data: subScenes = [] } = useQuery({
    queryKey: ['analytics-subscenes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sub_scenes').select('id, image_status, audio_status');
      if (error) throw error;
      return data;
    },
  });

  const totalProjects = projects.length;
  const totalSubScenes = subScenes.length;
  const imagesDone = subScenes.filter(s => s.image_status === 'done').length;
  const audiosDone = subScenes.filter(s => s.audio_status === 'done').length;

  const statusCounts = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  const barData = Object.entries(statusCounts).map(([status, count]) => ({
    name: STATUS_LABELS[status] || status,
    count,
  }));

  const pieData = [
    { name: 'Imagens prontas', value: imagesDone },
    { name: 'Imagens pendentes', value: totalSubScenes - imagesDone },
  ].filter(d => d.value > 0);

  const monthlyData = projects.reduce<Record<string, number>>((acc, p) => {
    const month = new Date(p.created_at).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {});

  const monthlyBarData = Object.entries(monthlyData).map(([month, count]) => ({ name: month, count }));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Analytics</h1>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2"><Film className="h-5 w-5 text-primary" /></div>
              <div>
                <p className="text-2xl font-bold">{totalProjects}</p>
                <p className="text-xs text-muted-foreground">Projetos</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-warning/10 p-2"><BarChart3 className="h-5 w-5 text-warning" /></div>
              <div>
                <p className="text-2xl font-bold">{totalSubScenes}</p>
                <p className="text-xs text-muted-foreground">Sub-cenas</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-success/10 p-2"><Image className="h-5 w-5 text-success" /></div>
              <div>
                <p className="text-2xl font-bold">{imagesDone}</p>
                <p className="text-xs text-muted-foreground">Imagens geradas</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-destructive/10 p-2"><Volume2 className="h-5 w-5 text-destructive" /></div>
              <div>
                <p className="text-2xl font-bold">{audiosDone}</p>
                <p className="text-xs text-muted-foreground">Áudios gerados</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Projetos por Status</CardTitle></CardHeader>
            <CardContent>
              {barData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--foreground))' }} />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-10">Nenhum dado ainda</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Progresso de Mídia</CardTitle></CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--foreground))' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-10">Nenhum dado ainda</p>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-sm">Projetos por Mês</CardTitle></CardHeader>
            <CardContent>
              {monthlyBarData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthlyBarData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--foreground))' }} />
                    <Bar dataKey="count" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-10">Nenhum dado ainda</p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
