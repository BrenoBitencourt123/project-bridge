import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, projectTitle, userPrompt } = await req.json();
    if (!projectId) throw new Error("projectId required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const prompt = `ABSOLUTE REQUIREMENT: 16:9 (1920x1080) widescreen.
CRITICAL LANGUAGE RULE: ALL visible text MUST be in PT-BR. NEVER English. Double-check spelling of every Portuguese word.

BACKGROUND: Dark blue (#1a3a5c) background FILLED with hand-drawn mathematical formulas, graphs, geometric shapes, arrows, question marks, light bulbs, and scientific symbols — like a chalkboard covered in doodles. These should be drawn in lighter blue (#4A90E2) outlines.

FOREGROUND: Two side-by-side panels on beige/cream paper, showing a "before and after" or "problem vs solution" concept related to the topic. Use cartoon-style characters with expressive faces. Left panel shows confusion/difficulty, right panel shows understanding/success.

TOP: Bold, large, impactful title text in PT-BR related to the topic. Use a casual, engaging YouTube thumbnail style — like a question or provocative statement. Maximum 5-6 words.

Style: Hand-drawn sketch, pencil lines, educational cartoon. Colors: dark blue background, beige panels, blue (#4A90E2) accents, black outlines.
NEVER include brand names, channel names, or logos.

Topic: "${projectTitle}". ${userPrompt || ""}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image-preview",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Image API error [${response.status}]: ${errText}`);
    }

    const result = await response.json();
    const images = result.choices?.[0]?.message?.images;
    if (!images || images.length === 0) throw new Error("No image generated");

    const imageDataUrl = images[0].image_url.url;
    const base64Data = imageDataUrl.split(",")[1];
    if (!base64Data) throw new Error("Invalid image data received");

    const imageBase64 = base64Data;
    const mimeType = "image/png";

    const imageBytes = base64Decode(imageBase64);
    const fileName = `${projectId}/thumbnail.png`;

    await supabase.storage.from("segment-images").upload(fileName, imageBytes, { upsert: true, contentType: mimeType });
    const { data: urlData } = supabase.storage.from("segment-images").getPublicUrl(fileName);
    const thumbnailUrl = urlData.publicUrl + `?t=${Date.now()}`;

    await supabase.from("projects").update({ thumbnail_url: thumbnailUrl, updated_at: new Date().toISOString() }).eq("id", projectId);

    return new Response(JSON.stringify({ thumbnailUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-thumbnail error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
