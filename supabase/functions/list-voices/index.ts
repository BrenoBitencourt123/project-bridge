import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RECOMMENDED_VOICES = [
  "onwK4e9ZLuTAKqWW03F9", // Daniel
  "EXAVITQu4vr4xnSDxMaL", // Sarah
  "JBFqnCBsd6RMkjVDRZzb", // George
  "pFZP5JQG7iQjIQuC4Bku", // Lily
  "FGY2WhTYpPnrIDTdsKH5", // Laura
  "TX3LPaxmHKxFdv7VOQHJ", // Liam
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs API error [${response.status}]: ${errText}`);
    }

    const data = await response.json();
    const voices = (data.voices || []).map((v: any) => {
      const labels = v.labels || {};
      const lang = v.fine_tuning?.language || "";
      const supportsPt = lang.includes("pt") ||
        labels.language?.toLowerCase().includes("portug") ||
        v.name?.toLowerCase().includes("portug") ||
        labels.use_case?.toLowerCase().includes("multilingual") ||
        true; // Most ElevenLabs voices support PT via multilingual models

      return {
        voice_id: v.voice_id,
        name: v.name,
        category: v.category || "premade",
        gender: labels.gender || "unknown",
        age: labels.age || "unknown",
        accent: labels.accent || "unknown",
        use_case: labels.use_case || "general",
        description: labels.description || v.description || "",
        supports_pt: supportsPt,
        is_recommended: RECOMMENDED_VOICES.includes(v.voice_id),
        preview_url: v.preview_url || "",
      };
    });

    // Sort: recommended first
    voices.sort((a: any, b: any) => (b.is_recommended ? 1 : 0) - (a.is_recommended ? 1 : 0));

    return new Response(JSON.stringify({ voices }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("list-voices error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
