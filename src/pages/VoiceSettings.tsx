import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { VoiceSettings as VoiceSettingsType, Voice } from '@/types/atlas';
import { useToast } from '@/hooks/use-toast';

const DEFAULT_SETTINGS: VoiceSettingsType = {
  voice_id: '',
  model: 'eleven_multilingual_v2',
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.5,
  speed: 1.0,
  speaker_boost: true,
  language_code: 'pt',
  output_format: 'mp3_44100_128',
};

export default function VoiceSettings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<VoiceSettingsType>(DEFAULT_SETTINGS);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    loadProfile();
    loadVoices();
  }, []);

  const loadProfile = async () => {
    const { data } = await supabase.from('profiles').select('voice_settings').eq('user_id', user!.id).single();
    if (data?.voice_settings) {
      setSettings({ ...DEFAULT_SETTINGS, ...(data.voice_settings as VoiceSettingsType) });
    }
  };

  const loadVoices = async () => {
    setLoadingVoices(true);
    try {
      const { data, error } = await supabase.functions.invoke('list-voices');
      if (error) throw error;
      setVoices(data.voices || []);
    } catch (err: any) {
      toast({ title: 'Erro ao carregar vozes', description: err.message, variant: 'destructive' });
    } finally {
      setLoadingVoices(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').update({ voice_settings: settings as any, updated_at: new Date().toISOString() }).eq('user_id', user!.id);
      if (error) throw error;
      toast({ title: 'Configurações salvas!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const playPreview = (url: string, voiceId: string) => {
    setPlayingId(voiceId);
    const audio = new Audio(url);
    audio.onended = () => setPlayingId(null);
    audio.play();
  };

  const update = (key: keyof VoiceSettingsType, value: any) => setSettings(s => ({ ...s, [key]: value }));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">Configurações de Voz</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        {/* Voice selection */}
        <div className="space-y-2">
          <Label>Voz</Label>
          {loadingVoices ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando vozes...</div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto rounded-md border p-2">
              {voices.map(v => (
                <div key={v.voice_id} className={`flex items-center justify-between rounded px-3 py-2 cursor-pointer hover:bg-accent ${settings.voice_id === v.voice_id ? 'bg-primary/10 border border-primary/30' : ''}`} onClick={() => update('voice_id', v.voice_id)}>
                  <div>
                    <span className="text-sm font-medium">{v.name}</span>
                    {v.is_recommended && <span className="ml-2 text-xs text-primary">★ Recomendada</span>}
                    <p className="text-xs text-muted-foreground">{v.gender} · {v.accent}</p>
                  </div>
                  {v.preview_url && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); playPreview(v.preview_url, v.voice_id); }}>
                      {playingId === v.voice_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sliders */}
        {[
          { key: 'stability' as const, label: 'Estabilidade', min: 0, max: 1, step: 0.05 },
          { key: 'similarity_boost' as const, label: 'Similaridade', min: 0, max: 1, step: 0.05 },
          { key: 'style' as const, label: 'Estilo', min: 0, max: 1, step: 0.05 },
          { key: 'speed' as const, label: 'Velocidade', min: 0.7, max: 1.2, step: 0.1 },
        ].map(({ key, label, min, max, step }) => (
          <div key={key} className="space-y-2">
            <div className="flex justify-between">
              <Label>{label}</Label>
              <span className="text-sm text-muted-foreground">{settings[key]}</span>
            </div>
            <Slider min={min} max={max} step={step} value={[settings[key] as number]} onValueChange={([v]) => update(key, v)} />
          </div>
        ))}

        {/* Speaker boost */}
        <div className="flex items-center justify-between">
          <Label>Speaker Boost</Label>
          <Switch checked={settings.speaker_boost} onCheckedChange={v => update('speaker_boost', v)} />
        </div>

        {/* Dropdowns */}
        <div className="space-y-2">
          <Label>Modelo</Label>
          <Select value={settings.model} onValueChange={v => update('model', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="eleven_multilingual_v2">Multilingual v2</SelectItem>
              <SelectItem value="eleven_turbo_v2_5">Turbo v2.5</SelectItem>
              <SelectItem value="eleven_turbo_v2">Turbo v2</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Idioma</Label>
          <Select value={settings.language_code} onValueChange={v => update('language_code', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pt">🇧🇷 Português</SelectItem>
              <SelectItem value="en">🇺🇸 English</SelectItem>
              <SelectItem value="es">🇪🇸 Español</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Formato</Label>
          <Select value={settings.output_format} onValueChange={v => update('output_format', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mp3_44100_128">MP3 192kbps</SelectItem>
              <SelectItem value="mp3_22050_32">MP3 128kbps</SelectItem>
              <SelectItem value="pcm_44100">WAV PCM</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button className="w-full" onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Salvar Configurações
        </Button>
      </main>
    </div>
  );
}
