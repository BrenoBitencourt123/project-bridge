import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Upload, Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

interface Asset {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  category: string;
  image_url: string;
  created_at: string;
}

const CATEGORIES = [
  { value: 'personagem', label: 'Personagem' },
  { value: 'objeto', label: 'Objeto' },
  { value: 'cenario', label: 'Cenário' },
  { value: 'general', label: 'Geral' },
];

export default function AssetsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [file, setFile] = useState<File | null>(null);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Asset[];
    },
  });

  const handleUpload = async () => {
    if (!file || !name.trim() || !user) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('user-assets')
        .upload(fileName, file, { contentType: file.type });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from('user-assets').getPublicUrl(fileName);

      const { error: insertErr } = await supabase.from('assets').insert({
        user_id: user.id,
        name: name.trim(),
        description: description.trim() || null,
        category,
        image_url: urlData.publicUrl,
      });
      if (insertErr) throw insertErr;

      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setDialogOpen(false);
      setName('');
      setDescription('');
      setCategory('general');
      setFile(null);
      toast({ title: 'Asset salvo!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const deleteAsset = useMutation({
    mutationFn: async (asset: Asset) => {
      // Extract path from URL
      const url = new URL(asset.image_url);
      const path = url.pathname.split('/user-assets/')[1];
      if (path) {
        await supabase.storage.from('user-assets').remove([decodeURIComponent(path)]);
      }
      const { error } = await supabase.from('assets').delete().eq('id', asset.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast({ title: 'Asset excluído' });
    },
    onError: (err: any) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Package className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Assets Visuais</h1>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4" /> Novo Asset</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload de Asset</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Nome</Label>
                  <Input placeholder="Ex: Professor João" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div>
                  <Label>Descrição (opcional)</Label>
                  <Textarea placeholder="Descreva o personagem ou objeto..." value={description} onChange={e => setDescription(e.target.value)} rows={3} />
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Imagem</Label>
                  <Input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] || null)} />
                </div>
                <Button className="w-full" onClick={handleUpload} disabled={!file || !name.trim() || uploading}>
                  {uploading ? <Loader2 className="animate-spin h-4 w-4" /> : <Upload className="h-4 w-4" />}
                  Upload
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">Nenhum asset ainda. Faça upload de personagens, objetos e cenários!</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {assets.map(asset => (
              <Card key={asset.id} className="group overflow-hidden">
                <div className="aspect-square bg-muted/50 relative overflow-hidden">
                  <img src={asset.image_url} alt={asset.name} className="h-full w-full object-cover" />
                  <Badge className="absolute left-2 top-2 bg-background/80 text-foreground text-xs">
                    {CATEGORIES.find(c => c.value === asset.category)?.label || asset.category}
                  </Badge>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute right-2 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => e.stopPropagation()}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir asset?</AlertDialogTitle>
                        <AlertDialogDescription>"{asset.name}" será removido permanentemente.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteAsset.mutate(asset)}>Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <CardContent className="p-3">
                  <h3 className="font-medium text-sm truncate">{asset.name}</h3>
                  {asset.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{asset.description}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
