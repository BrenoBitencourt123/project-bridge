import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function expandAbbreviations(text: string): string {
  return text
    .replace(/\bENEM\b/g, "ênêm")
    .replace(/\bEUA\b/g, "Estados Unidos")
    .replace(/\bONU\b/g, "ó êne u")
    .replace(/\bPIB\b/g, "pê i bê")
    .replace(/(\d+)%/g, "$1 por cento")
    .replace(/(\d+)°C/g, "$1 graus Celsius")
    .replace(/\bkm\b/g, "quilômetros")
    .replace(/\bkg\b/g, "quilogramas");
}

function splitTextIntoChunks(text: string, maxChars = 4500): string[] {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { rawScript, projectId } = await req.json();
    if (!rawScript || !projectId) throw new Error("rawScript and projectId required");

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get voice settings from user's profile
    const authHeader = req.headers.get("Authorization");
    let voiceSettings: any = null;
    if (authHeader) {
      const userSupabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userSupabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from("profiles").select("voice_settings").eq("user_id", user.id).single();
        voiceSettings = profile?.voice_settings;
      }
    }

    const voiceId = voiceSettings?.voice_id || "onwK4e9ZLuTAKqWW03F9";
    const model = voiceSettings?.model || "eleven_multilingual_v2";
    const expandedScript = expandAbbreviations(rawScript);
    const chunks = splitTextIntoChunks(expandedScript);

    const generateChunk = async (text: string, prevText?: string, nextText?: string) => {
      const body: any = {
        text,
        model_id: model,
        voice_settings: {
          stability: voiceSettings?.stability ?? 0.5,
          similarity_boost: voiceSettings?.similarity_boost ?? 0.75,
          style: voiceSettings?.style ?? 0.5,
          use_speaker_boost: voiceSettings?.speaker_boost ?? true,
          speed: voiceSettings?.speed ?? 1.0,
        },
      };
      if (prevText) body.previous_text = prevText;
      if (nextText) body.next_text = nextText;

      const resp = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
        {
          method: "POST",
          headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`ElevenLabs API error [${resp.status}]: ${errText}`);
      }

      return await resp.json();
    };

    if (chunks.length === 1) {
      const result = await generateChunk(chunks[0]);
      return new Response(JSON.stringify({
        fullAudioBase64: result.audio_base64,
        alignment: result.alignment,
        isChunked: false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Multiple chunks
    const chunkResults = [];
    for (let i = 0; i < chunks.length; i++) {
      const prev = i > 0 ? chunks[i - 1].slice(-200) : undefined;
      const next = i < chunks.length - 1 ? chunks[i + 1].slice(0, 200) : undefined;
      const result = await generateChunk(chunks[i], prev, next);
      chunkResults.push({
        audioBase64: result.audio_base64,
        alignment: result.alignment,
      });
    }

    return new Response(JSON.stringify({
      isChunked: true,
      chunks: chunkResults,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-audio-batch error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
