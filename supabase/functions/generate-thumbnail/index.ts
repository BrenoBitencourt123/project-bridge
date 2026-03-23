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
Hand-drawn sketch style thumbnail on beige/cream paper background. Pencil line drawing with blue (#4A90E2) accents.
CRITICAL LANGUAGE RULE: ALL visible text MUST be in PT-BR. NEVER English.
Educational video thumbnail for: "${projectTitle}". ${userPrompt || ""}.
Wide format, visually compelling, suitable for YouTube thumbnail.`;

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
    const content = result.choices?.[0]?.message?.content;

    // Extract base64 image from response
    let imageBase64: string | null = null;
    let mimeType = "image/png";

    if (typeof content === "string") {
      // Check for inline base64 image pattern
      const b64Match = content.match(/data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)/);
      if (b64Match) {
        mimeType = b64Match[1];
        imageBase64 = b64Match[2];
      }
    } else if (Array.isArray(content)) {
      const imgPart = content.find((p: any) => p.type === "image_url" || (p.type === "image" && p.source?.data));
      if (imgPart?.source?.data) {
        imageBase64 = imgPart.source.data;
        mimeType = imgPart.source?.media_type || "image/png";
      } else if (imgPart?.image_url?.url) {
        const urlMatch = imgPart.image_url.url.match(/data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)/);
        if (urlMatch) {
          mimeType = urlMatch[1];
          imageBase64 = urlMatch[2];
        }
      }
    }

    // Also check for inline_data format (Gemini native)
    if (!imageBase64) {
      const parts = result.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
      if (imagePart) {
        imageBase64 = imagePart.inlineData.data;
        mimeType = imagePart.inlineData.mimeType;
      }
    }

    if (!imageBase64) throw new Error("No image generated");

    const imageBytes = base64Decode(imageBase64);
    const fileName = `${projectId}/thumbnail.png`;

    await supabase.storage.from("segment-images").upload(fileName, imageBytes, { upsert: true, contentType: mimeType });
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
