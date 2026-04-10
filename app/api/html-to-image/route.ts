import { NextRequest } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const maxDuration = 60;

type ImageType = "png" | "jpg" | "jpeg";

type BodyPayload = {
  html: string;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  type?: ImageType;
  quality?: number; // only jpeg/jpg
  fullPage?: boolean;
  selector?: string; // optional screenshot specific element
  transparent?: boolean; // useful for png
  waitForMs?: number;
  background?: string; // body background fallback
};

function normalizeType(type?: string): ImageType {
  if (!type) return "png";
  const t = type.toLowerCase();
  if (t === "jpg") return "jpg";
  if (t === "jpeg") return "jpeg";
  return "png";
}

function contentTypeFromImageType(type: ImageType): string {
  if (type === "jpg" || type === "jpeg") return "image/jpeg";
  return "image/png";
}

function clampQuality(q?: number): number | undefined {
  if (typeof q !== "number") return undefined;
  if (Number.isNaN(q)) return undefined;
  return Math.max(0, Math.min(100, q));
}

function wrapHtmlDocument(rawHtml: string, background?: string) {
  const hasHtmlTag = /<html[\s>]/i.test(rawHtml);
  if (hasHtmlTag) return rawHtml;

  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: ${background || "transparent"};
      }
      * {
        box-sizing: border-box;
      }
    </style>
  </head>
  <body>
    ${rawHtml}
  </body>
</html>`;
}

export async function POST(req: NextRequest) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    const body = (await req.json()) as BodyPayload;

    if (!body?.html || typeof body.html !== "string") {
      return new Response(
        JSON.stringify({
          error: "Field 'html' wajib diisi dan harus berupa string"
        }),
        {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    }

    const width = Math.max(1, Math.min(body.width ?? 1200, 4000));
    const height = Math.max(1, Math.min(body.height ?? 630, 4000));
    const deviceScaleFactor = Math.max(
      1,
      Math.min(body.deviceScaleFactor ?? 2, 4)
    );
    const type = normalizeType(body.type);
    const quality = clampQuality(body.quality);
    const fullPage = Boolean(body.fullPage);
    const transparent = Boolean(body.transparent);
    const waitForMs = Math.max(0, Math.min(body.waitForMs ?? 300, 10000));

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: {
        width,
        height,
        deviceScaleFactor
      },
      executablePath: await chromium.executablePath(),
      headless: true
    });

    const page = await browser.newPage();

    await page.setViewport({
      width,
      height,
      deviceScaleFactor
    });

    const html = wrapHtmlDocument(body.html, body.background);

    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle0"]
    });

    if (waitForMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitForMs));
    }

    let imageBuffer: Uint8Array;

    if (body.selector) {
      const element = await page.waitForSelector(body.selector, {
        timeout: 15000
      });

      if (!element) {
        return new Response(
          JSON.stringify({
            error: `Selector tidak ketemu: ${body.selector}`
          }),
          {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" }
          }
        );
      }

      imageBuffer = await element.screenshot({
        type: type === "jpg" ? "jpeg" : type,
        quality:
          type === "jpg" || type === "jpeg"
            ? quality ?? 90
            : undefined,
        omitBackground: type === "png" ? transparent : false
      });
    } else {
      imageBuffer = await page.screenshot({
        type: type === "jpg" ? "jpeg" : type,
        quality:
          type === "jpg" || type === "jpeg"
            ? quality ?? 90
            : undefined,
        fullPage,
        omitBackground: type === "png" ? transparent : false
      });
    }

    return new Response(imageBuffer, {
      status: 200,
      headers: {
        "content-type": contentTypeFromImageType(type),
        "cache-control": "public, max-age=0, s-maxage=86400"
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({
        error: "Gagal render HTML ke image",
        detail: message
      }),
      {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
