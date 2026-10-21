/**
 * Process PDF with vision model (for scanned PDFs)
 * @param {Array} images - Array of {page, dataUrl}
 * @param {string} question - User's question
 * @param {Object} studentProfile - Student profile
 * @returns {Promise<string>}
 */
async function analyzePDFWithVision(images, question, studentProfile) {
  const { subject } = studentProfile;
  const requestStart = Date.now();
  
  // Strip data: prefix from all images - Ollama expects raw base64
  const base64Images = images.map(img => 
    img.dataUrl.startsWith('data:') ? img.dataUrl.split(',')[1] : img.dataUrl
  );
  
  // Validation and diagnostics
  console.log('[Vision] Host:', config.ollamaHost);
  console.log('[Vision] Model:', VISION_MODEL);
  console.log('[Vision] Image count:', base64Images.length);
  console.log('[Vision] Config:', { numPredict: VISION_CONFIG.numPredict, numCtx: VISION_CONFIG.numCtx, timeoutMs: VISION_CONFIG.timeoutMs });
  
  let totalBase64Len = 0;
  base64Images.forEach((img, index) => {
    try {
      const buffer = Buffer.from(img, 'base64');
      totalBase64Len += img.length;
      
      console.log(`[Vision] Image ${index + 1}:`, {
        base64Length: img.length,
        bufferLength: buffer.length,
        pngSignature: buffer.subarray(0, 8).toString('hex'),
        isValidPng: buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      });
      
      if (buffer.length === 0) {
        throw new Error(`Image ${index + 1} is empty (0 bytes after base64 decode)`);
      }
      
      if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        console.warn(`[Vision] Image ${index + 1} may not be a valid PNG (signature: ${buffer.subarray(0, 8).toString('hex')})`);
      }
    } catch (e) {
      console.error(`[Vision] Image ${index + 1} validation failed:`, e.message);
      throw new Error(`Invalid image data for page ${index + 1}: ${e.message}`);
    }
  });
  console.log(`[Vision] Total base64 payload: ${totalBase64Len} chars (${(totalBase64Len / 1024).toFixed(1)} KB)`);
  
  const systemPrompt = `You are PuGPT, a tutor for ${subject}. Analyze the attached PDF pages (as images) and answer the user's question. If something is unclear or unreadable, say so instead of guessing.`;

  try {
    console.log('[Vision] Sending request to Ollama...');
    const ollamaStart = Date.now();
    
    const response = await ollama.chat({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Question: ${question}\n\n[${images.length} PDF pages attached]`,
          images: base64Images,
        },
      ],
      options: {
        temperature: 0.3,
        num_predict: VISION_CONFIG.numPredict,
        num_ctx: VISION_CONFIG.numCtx,
        keep_alive: -1,
      },
      stream: false,
    });
    
    console.log(`[Vision] Ollama response received in ${Date.now() - ollamaStart}ms (total: ${Date.now() - requestStart}ms)`);
    return response.message.content;

  } catch (error) {
    console.error('[Vision] PDF analysis error:', error);
    console.error('[Vision] Total elapsed:', Date.now() - requestStart, 'ms');
    throw new Error(`PDF vision analysis failed: ${error.message}`);
  }
}