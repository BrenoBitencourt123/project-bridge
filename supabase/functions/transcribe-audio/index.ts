import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const formData = await req.formData();
    const audioFile = formData.get("audio");
    if (!audioFile || !(audioFile instanceof File)) throw new Error("Audio file required");

    // Send to Whisper
    const whisperForm = new FormData();
    whisperForm.append("file", audioFile);
    whisperForm.append("model", "whisper-1");
    whisperForm.append("response_format", "verbose_json");
    whisperForm.append("timestamp_granularities[]", "word");
    whisperForm.append("language", "pt");

    const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: whisperForm,
    });

    if (!whisperResp.ok) {
      const errText = await whisperResp.text();
      throw new Error(`Whisper API error [${whisperResp.status}]: ${errText}`);
    }

    const whisperData = await whisperResp.json();
    const words = whisperData.words || [];

    // Convert word-level timestamps to character-level
    const characters: string[] = [];
    const charStartTimes: number[] = [];
    const charEndTimes: number[] = [];

    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      const text = word.word || "";
      const start = word.start || 0;
      const end = word.end || 0;
      const charDuration = text.length > 0 ? (end - start) / text.length : 0;

      for (let c = 0; c < text.length; c++) {
        characters.push(text[c]);
        charStartTimes.push(start + c * charDuration);
        charEndTimes.push(start + (c + 1) * charDuration);
      }

      // Add space between words (except last)
      if (w < words.length - 1) {
        const nextStart = words[w + 1].start || end;
        characters.push(" ");
        charStartTimes.push(end);
        charEndTimes.push(nextStart);
      }
    }

    return new Response(JSON.stringify({
      alignment: {
        characters,
        character_start_times_seconds: charStartTimes,
        character_end_times_seconds: charEndTimes,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("transcribe-audio error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
