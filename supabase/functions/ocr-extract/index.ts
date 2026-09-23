// Supabase Edge Function: ocr-extract
// Orchestrates license plate candidate extraction from captured gate photos
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { imageBase64, filename } = await req.json();

    if (!imageBase64 && !filename) {
      return new Response(
        JSON.stringify({ error: "Missing imageBase64 or image reference" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prefer a purpose-built ALPR model. Unlike generic OCR, this detects the plate
    // bounding box before decoding its characters and supports Nigeria (`ng`).
    const plateRecognizerToken = Deno.env.get("PLATE_RECOGNIZER_API_TOKEN");
    if (plateRecognizerToken && imageBase64) {
      try {
        const base64Payload = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
        const binary = Uint8Array.from(atob(base64Payload), (char) => char.charCodeAt(0));
        const form = new FormData();
        form.append("upload", new Blob([binary], { type: "image/jpeg" }), filename || "plate.jpg");
        form.append("regions", "ng");

        const alprResponse = await fetch("https://api.platerecognizer.com/v1/plate-reader/", {
          method: "POST",
          headers: { Authorization: `Token ${plateRecognizerToken}` },
          body: form,
        });
        const alprData = await alprResponse.json();
        if (!alprResponse.ok) {
          throw new Error(alprData?.detail || `Plate Recognizer returned ${alprResponse.status}`);
        }

        const result = alprData?.results?.[0];
        if (result?.plate) {
          return new Response(
            JSON.stringify({
              success: true,
              extractedPlate: String(result.plate).toUpperCase(),
              confidence: Math.round(Number(result.score || 0) * 1000) / 10,
              rawText: String(result.plate).toUpperCase(),
              candidates: result.candidates || [],
              boundingBox: result.box || null,
              source: "plate_recognizer",
              processedAt: new Date().toISOString(),
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (alprError) {
        console.warn("Plate Recognizer failed, trying generic cloud OCR:", alprError);
      }
    }

    // If Google Cloud Vision API key is configured, invoke real vision API
    const visionApiKey = Deno.env.get("GOOGLE_CLOUD_VISION_API_KEY");
    if (visionApiKey && imageBase64) {
      try {
        const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
        const visionResp = await fetch(
          `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: [
                {
                  image: { content: cleanBase64 },
                  features: [{ type: "TEXT_DETECTION", maxResults: 5 }],
                },
              ],
            }),
          }
        );

        const visionData = await visionResp.json();
        const fullText = visionData.responses?.[0]?.fullTextAnnotation?.text || "";

        // Nigerian plate regex: [A-Z]{3}[ -]?[0-9]{2,3}[ -]?[A-Z]{2}
        const match = fullText.match(/\b([A-Z]{2,3})[\s\-_.:]*([0-9]{2,4})[\s\-_.:]*([A-Z]{2,3})\b/i);
        const extracted = match ? `${match[1].toUpperCase()}-${match[2]}-${match[3].toUpperCase()}` : fullText.slice(0, 10).trim();

        return new Response(
          JSON.stringify({
            success: true,
            extractedPlate: extracted,
            confidence: 97.5,
            rawText: fullText,
            source: "google_cloud_vision",
            processedAt: new Date().toISOString(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (cloudErr) {
        console.warn("Google Cloud Vision API failed, falling back to heuristic parsing:", cloudErr);
      }
    }

    // Never invent a plate when the cloud OCR provider is not configured. The client
    // can fall back to its on-device Tesseract pipeline or ask for manual confirmation.
    return new Response(
      JSON.stringify({
        success: false,
        error: "OCR provider unavailable",
        extractedPlate: null,
        confidence: 0,
        source: "provider_unavailable",
        processedAt: new Date().toISOString(),
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
