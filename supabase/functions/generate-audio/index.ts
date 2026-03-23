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
    .replace(/\bkg\b/g, "quilogramas")
    .replace(/\bcm\b/g, "centímetros")
    .replace(/\bmm\b/g, "milímetros");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { narration, projectId, segmentId, sequenceNumber, previousText, nextText } = await req.json();
    if (!narration || !projectId) throw new Error("narration and projectId required");

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get user voice settings from auth header
    const authHeader = req.headers.get("Authorization");
    let voiceSettings: any = null;
    if (authHeader) {
      const userSupabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: claims } = await userSupabase.auth.getClaims(authHeader.replace("Bearer ", ""));
      if (claims?.claims?.sub) {
        const { data: profile } = await supabase.from("profiles").select("voice_settings").eq("user_id", claims.claims.sub).single();
        voiceSettings = profile?.voice_settings;
      }
    }

    const voiceId = voiceSettings?.voice_id || "onwK4e9ZLuTAKqWW03F9"; // Daniel default
    const model = voiceSettings?.model || "eleven_multilingual_v2";
    const outputFormat = voiceSettings?.output_format || "mp3_44100_128";
    const expandedText = expandAbbreviations(narration);

    const body: any = {
      text: expandedText,
      model_id: model,
      voice_settings: {
        stability: voiceSettings?.stability ?? 0.5,
        similarity_boost: voiceSettings?.similarity_boost ?? 0.75,
        style: voiceSettings?.style ?? 0.5,
        use_speaker_boost: voiceSettings?.speaker_boost ?? true,
        speed: voiceSettings?.speed ?? 1.0,
      },
    };

    if (previousText) body.previous_text = previousText;
    if (nextText) body.next_text = nextText;

    const ttsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`,
      {
        method: "POST",
        headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!ttsResponse.ok) {
      const errText = await ttsResponse.text();
      throw new Error(`ElevenLabs API error [${ttsResponse.status}]: ${errText}`);
    }

    const audioBuffer = await ttsResponse.arrayBuffer();
    const num = String(sequenceNumber).padStart(3, "0");
    const ext = outputFormat.startsWith("pcm") ? "wav" : "mp3";
    const fileName = `${projectId}/segment-${num}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("segment-audio")
      .upload(fileName, new Uint8Array(audioBuffer), { upsert: true, contentType: ext === "mp3" ? "audio/mpeg" : "audio/wav" });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from("segment-audio").getPublicUrl(fileName);

    return new Response(JSON.stringify({ audioUrl: urlData.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-audio error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
