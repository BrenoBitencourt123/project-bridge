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

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const prompt = `Hand-drawn sketch style thumbnail on beige/cream paper background. Pencil line drawing with blue (#4A90E2) accents. Educational video thumbnail for: "${projectTitle}". ${userPrompt || ""}. Wide format, visually compelling, suitable for YouTube thumbnail.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"], temperature: 0.4 },
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
    const fileName = `${projectId}/thumbnail.png`;

    await supabase.storage.from("segment-images").upload(fileName, imageBytes, { upsert: true, contentType: "image/png" });
    const { data: urlData } = supabase.storage.from("segment-images").getPublicUrl(fileName);
    const thumbnailUrl = urlData.publicUrl;

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
