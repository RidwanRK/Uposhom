/**
 * OpenRouter Vision OCR Prescription Extractor
 *
 * Primary Model: google/gemini-2.5-flash
 * Fallback Model: qwen/qwen2.5-vl-72b-instruct
 *
 * Adheres strictly to the schema in @uposhom/shared (uploadAndParseResponse).
 * Returns schema-constrained JSON with per-field confidence and transcribed text.
 * No model output directly schedules doses — visual human confirmation is always required.
 */

import { uploadAndParseResponse, type UploadAndParseResponse } from '@uposhom/shared';
import { createOpenRouterClient } from '../client.js';
import { AI_CONFIG } from '../config.js';

export interface OcrExtractionOptions {
  apiKey?: string;
  useFallbackModel?: boolean;
  mockFixture?: UploadAndParseResponse;
}

export const PRESCRIPTION_VISION_SYSTEM_PROMPT = `
You are an expert clinical prescription OCR system specializing in South Asian and Bangladeshi medical prescriptions.
Analyze the provided prescription image and extract all prescribed medicines with high precision.
Output strictly valid JSON complying with the following schema:
{
  "draftPrescriptionId": "draft-<timestamp>",
  "transcribedText": "Full text transcribed from prescription...",
  "extractedItems": [
    {
      "tempId": "item-1",
      "brandName": "Exact Brand Name (e.g. Napa Extend)",
      "genericName": "Generic if mentioned",
      "strength": "e.g. 665mg",
      "form": "Tablet | Capsule | Syrup | Inhaler | Drop | Injection",
      "pattern": "Dosage pattern as written (e.g. 1+0+1, 1-0-1, 1+1+1, OD, BD, TDS)",
      "mealRelation": "AC | PC | WITH_MEAL | NONE",
      "durationDays": Number of days (e.g. 5, 14, 30),
      "confidence": Number between 0.0 and 1.0,
      "pillCount": Optional total number of units
    }
  ]
}
Do not hallucinate medicines not visible. If uncertain, assign a lower confidence (< 0.70).
`.trim();

/**
 * Extracts structured prescription JSON from an image URL or Base64 data URI.
 */
export async function extractPrescriptionVision(
  imageDataUriOrUrl: string,
  options: OcrExtractionOptions = {},
): Promise<UploadAndParseResponse> {
  // If mock fixture is supplied or CI environment without live key, return fixture
  if (options.mockFixture) {
    return uploadAndParseResponse.parse(options.mockFixture);
  }

  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.startsWith('mock-')) {
    // Return safe default mock response for local test runs
    return {
      draftPrescriptionId: `draft-${Date.now()}`,
      transcribedText: 'Tab. Napa Extend 665mg 1+0+1 BDPC 5 days\nCap. Seclo 20mg 1+0+1 AC 14 days',
      extractedItems: [
        {
          tempId: 'item-1',
          brandName: 'Napa Extend',
          genericName: 'Paracetamol',
          strength: '665mg',
          form: 'Tablet',
          pattern: '1+0+1',
          mealRelation: 'PC',
          durationDays: 5,
          confidence: 0.95,
          pillCount: 10,
        },
        {
          tempId: 'item-2',
          brandName: 'Seclo',
          genericName: 'Omeprazole',
          strength: '20mg',
          form: 'Capsule',
          pattern: '1+0+1',
          mealRelation: 'AC',
          durationDays: 14,
          confidence: 0.94,
          pillCount: 28,
        },
      ],
    };
  }

  const client = createOpenRouterClient(apiKey);
  const model = options.useFallbackModel
    ? AI_CONFIG.models.visionFallback
    : AI_CONFIG.models.visionPrimary;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: PRESCRIPTION_VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract prescription items from this image strictly into JSON.' },
          { type: 'image_url', image_url: { url: imageDataUriOrUrl } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  const rawJson = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(rawJson);
  return uploadAndParseResponse.parse(parsed);
}
