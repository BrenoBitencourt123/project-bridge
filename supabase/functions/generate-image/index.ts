import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imagePrompt, projectId, segmentId, sequenceNumber, subIndex, momentType } = await req.json();
    if (!imagePrompt || !projectId) throw new Error("imagePrompt and projectId required");

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const fullPrompt = `ABSOLUTE REQUIREMENT: Aspect ratio 16:9 (1920x1080 widescreen).
CRITICAL LANGUAGE RULE: ALL visible text in the image MUST be in Brazilian Portuguese (PT-BR). NEVER use English text.
ANTI-NARRATION TEXT RULE: NEVER transcribe full narration sentences into the image. Maximum 1-4 visible words (titles, labels, numeric values only).
ACRONYM RULE: Use correct abbreviated form of acronyms, never spell them phonetically.
COMPOSITION RULE: Main element centered occupying 60-70% of the frame. Supporting context at the edges.
STYLE: Hand-drawn sketch on beige/cream paper background. Pencil cross-hatching with slight roughness. Grayscale tones with ONLY blue (#4A90E2) as accent color for highlights and emphasis. Educational illustration style.
NEVER include brand names, channel names, or logos.

Scene: ${imagePrompt}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            temperature: 0.4,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Image API error [${response.status}]: ${errText}`);
    }

    const result = await response.json();
    const parts = result.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));

    if (!imagePart) throw new Error("No image generated");

    const imageBytes = base64Decode(imagePart.inlineData.data);
    const num = String(sequenceNumber).padStart(3, "0");
    const subSuffix = subIndex ? `-sub-${subIndex}` : "";
    const fileName = `${projectId}/segment-${num}${subSuffix}.png`;

    const { error: uploadErr } = await supabase.storage
      .from("segment-images")
      .upload(fileName, imageBytes, { upsert: true, contentType: "image/png" });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from("segment-images").getPublicUrl(fileName);

    return new Response(JSON.stringify({ imageUrl: urlData.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
