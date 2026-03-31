// 磁磚場景模擬系統 v4.0 - 重構版
// 功能：深度分析 + 場景推薦 + 多方案生成

require('dotenv').config();

const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// 設定上傳目錄
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 靜態檔案服務
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/'
});

fastify.register(require('@fastify/multipart'));

// ========== 磁磚風格資料庫 ==========
const TILE_STYLES = {
  '現代簡約': {
    keywords: ['modern', 'minimalist', 'clean lines', 'simple'],
    rooms: ['living room', 'kitchen', 'bathroom'],
    mood: '清爽明亮'
  },
  '北歐自然': {
    keywords: ['scandinavian', 'natural', 'wood', 'cozy'],
    rooms: ['living room', 'bedroom', 'study'],
    mood: '溫暖舒適'
  },
  '工業 Loft': {
    keywords: ['industrial', 'loft', 'exposed brick', 'metal'],
    rooms: ['living room', 'kitchen', 'studio'],
    mood: '粗獷個性'
  },
  '奢華古典': {
    keywords: ['luxury', 'classic', 'marble', 'elegant'],
    rooms: ['living room', 'bathroom', 'dining room'],
    mood: '高貴典雅'
  },
  '日式禪風': {
    keywords: ['japanese', 'zen', 'minimalist', 'natural'],
    rooms: ['bedroom', 'study', 'tea room'],
    mood: '寧靜沉穩'
  },
  '地中海': {
    keywords: ['mediterranean', 'coastal', 'blue', 'white'],
    rooms: ['balcony', 'bathroom', 'kitchen'],
    mood: '清爽悠閒'
  }
};

// ========== API 路由 ==========

// 0. API 狀態檢查
fastify.get('/api/status', async (request, reply) => {
  return {
    success: true,
    apiKeys: {
      replicate: !!process.env.REPLICATE_API_TOKEN,
      openai: !!process.env.OPENAI_API_KEY
    },
    server: { version: '4.0.0', uptime: process.uptime() }
  };
});

// 1. 上傳磁磚圖片
fastify.post('/api/upload', async (request, reply) => {
  const data = await request.file();
  if (!data || !data.file) {
    return reply.code(400).send({ error: '沒有上傳檔案' });
  }
  
  const ext = path.extname(data.filename) || '.jpg';
  const newFilename = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
  const newPath = path.join(uploadDir, newFilename);
  
  const stream = fs.createWriteStream(newPath);
  await new Promise((resolve, reject) => {
    data.file.pipe(stream);
    data.file.on('end', resolve);
    data.file.on('error', reject);
  });
  
  return { success: true, filePath: `/uploads/${newFilename}`, fileName: newFilename };
});

// 2. 深度磁磚分析
fastify.post('/api/analyze', async (request, reply) => {
  const { tilePath, width, height, sizeUnit, color, material } = request.body;
  
  if (!tilePath) {
    return reply.code(400).send({ error: '缺少磁磚圖片路徑' });
  }

  let detectedColor = color;
  let detectedMaterial = material;
  let detectedPattern = '未知';
  let detectedStyle = '現代簡約';
  let confidence = 0;
  
  // 使用 OpenAI Vision 進行深度分析
  if (process.env.OPENAI_API_KEY) {
    try {
      const tileImagePath = path.join(__dirname, tilePath);
      const imageBuffer = fs.readFileSync(tileImagePath);
      const ext = path.extname(tileImagePath).toLowerCase();
      const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
      const mimeType = mimeTypes[ext] || 'image/jpeg';
      const base64Image = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
      
      const visionResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: `分析這張磁磚圖片，請用 JSON 格式回傳以下資訊：
{
  "color": "主要顏色（中文）",
  "material": "材質（瓷磚/石材/木材/馬賽克/水泥）",
  "pattern": "紋理類型（木紋/大理石紋/幾何/花卉/純色/條紋）",
  "style": "風格（現代簡約/北歐自然/工業Loft/奢華古典/日式禪風/地中海）",
  "confidence": 0.85
}

只回傳 JSON，不要其他說明。` 
              },
              { type: 'image_url', image_url: { url: base64Image } }
            ]
          }],
          max_tokens: 300
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      
      const resultText = visionResponse.data.choices[0].message.content.trim();
      try {
        // 提取 JSON
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          detectedColor = analysis.color || color;
          detectedMaterial = analysis.material || material;
          detectedPattern = analysis.pattern || '未知';
          detectedStyle = analysis.style || '現代簡約';
          confidence = analysis.confidence || 0.5;
        }
      } catch (e) {
        console.log('JSON 解析失敗:', e.message);
      }
    } catch (e) {
      console.log('深度分析失敗:', e.message);
    }
  }
  
  // 推薦適用房間
  const recommendedRooms = getRecommendedRooms(detectedMaterial, detectedStyle);
  
  // 推薦場景風格
  const recommendedStyles = getRecommendedStyles(detectedColor, detectedMaterial, detectedPattern);
  
  const analysis = {
    color: detectedColor,
    material: detectedMaterial,
    pattern: detectedPattern,
    style: detectedStyle,
    confidence: confidence,
    recommendedRooms: recommendedRooms,
    recommendedStyles: recommendedStyles,
    // 轉換尺寸
    widthCm: convertSize(width, sizeUnit, 'cm'),
    heightCm: convertSize(height, sizeUnit, 'cm')
  };
  
  return { success: true, analysis };
});

// 3. 場景推薦
fastify.post('/api/recommend', async (request, reply) => {
  const { analysis } = request.body;
  
  if (!analysis) {
    return reply.code(400).send({ error: '缺少分析結果' });
  }
  
  const recommendations = generateRecommendations(analysis);
  
  return { success: true, recommendations };
});

// 4. 生成場景模擬圖 (ControlNet)
fastify.post('/api/generate', async (request, reply) => {
  const { tilePath, analysis, roomType = 'living room', style = '現代簡約', options = {} } = request.body;
  
  if (!tilePath || !analysis) {
    return reply.code(400).send({ error: '缺少必要參數' });
  }

  try {
    const prompt = buildAdvancedPrompt(analysis, roomType, style);
    const tileImagePath = path.join(__dirname, tilePath);
    
    // === 主要方案：Replicate + ControlNet Canny ===
    if (process.env.REPLICATE_API_TOKEN) {
      const versionId = 'aff48af9c68d162388d230a2ab003f68d2638d88307bdaf1c2f1ac95079c9613';
      
      // 將圖片轉換為 base64
      const imageBuffer = fs.readFileSync(tileImagePath);
      const ext = path.extname(tileImagePath).toLowerCase();
      const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
      const mimeType = mimeTypes[ext] || 'image/jpeg';
      const base64Image = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
      
      console.log('生成場景:', { roomType, style, prompt });
      
      // 控制參數
      const scale = options.scale || 9;
      const steps = options.steps || 30;
      
      const response = await axios.post(
        'https://api.replicate.com/v1/predictions',
        {
          version: versionId,
          input: {
            image: base64Image,
            prompt: prompt,
            a_prompt: 'good quality, highly detailed, realistic interior, professional photography, 8k',
            n_prompt: 'bad quality, blurry, distorted, ugly, watermark, text, deformed',
            num_samples: '1',
            image_resolution: '512',
            ddim_steps: steps,
            scale: scale,
            eta: 0,
            low_threshold: 100,
            high_threshold: 200
          }
        },
        {
          headers: {
            'Authorization': 'Token ' + process.env.REPLICATE_API_TOKEN,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );
      
      const result = response.data;
      
      // 輪詢等待結果
      if (result.status !== 'succeeded' && result.status !== 'failed') {
        let attempts = 0;
        while (attempts < 45) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const check = await axios.get(result.urls.get, {
              headers: { 'Authorization': 'Token ' + process.env.REPLICATE_API_TOKEN }
            });
            if (check.data.status === 'succeeded') {
              return { 
                success: true, 
                imageUrl: check.data.output[1], 
                prompt: prompt,
                style: style,
                roomType: roomType,
                provider: 'controlnet-canny'
              };
            } else if (check.data.status === 'failed') {
              return reply.code(500).send({ error: 'AI 生成失敗', detail: check.data.error });
            }
          } catch (e) { break; }
          attempts++;
        }
        return reply.code(500).send({ error: 'AI 生成逾時' });
      }
      
      if (result.status === 'succeeded') {
        return { 
          success: true, 
          imageUrl: result.output[1], 
          prompt: prompt,
          style: style,
          roomType: roomType,
          provider: 'controlnet-canny'
        };
      } else {
        return reply.code(500).send({ error: 'AI 生成失敗', detail: result.error });
      }
    }
    
    // Demo 模式
    return {
      success: true,
      message: 'demo mode',
      prompt: prompt,
      imageUrl: `https://placehold.co/800x600/e8e4dc/666?text=${encodeURIComponent(roomType + ' - ' + style)}`,
      provider: 'demo'
    };
  } catch (error) {
    console.error('生成失敗:', error.message);
    return reply.code(500).send({ error: '場景生成失敗: ' + error.message });
  }
});

// 5. 多方案生成
fastify.post('/api/generate-multiple', async (request, reply) => {
  const { tilePath, analysis, roomType = 'living room', styles = ['現代簡約', '北歐自然'] } = request.body;
  
  if (!tilePath || !analysis) {
    return reply.code(400).send({ error: '缺少必要參數' });
  }
  
  const results = [];
  
  for (const style of styles) {
    try {
      // 呼叫單一生成功能
      const response = await axios.post(
        `http://localhost:3000/api/generate`,
        { tilePath, analysis, roomType, style },
        { timeout: 120000 }
      );
      results.push({
        style: style,
        ...response.data
      });
    } catch (e) {
      results.push({
        style: style,
        success: false,
        error: e.message
      });
    }
  }
  
  return { success: true, results };
});

// 6. 搜尋相似場景
fastify.post('/api/search-scenes', async (request, reply) => {
  const { color, material, roomType } = request.body;
  const keywords = buildSearchKeywords(color, material, roomType);
  
  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const response = await axios.get(
        'https://api.unsplash.com/search/photos',
        {
          params: { query: keywords, per_page: 6, orientation: 'landscape' },
          headers: { 'Authorization': 'Client-ID ' + process.env.UNSPLASH_ACCESS_KEY }
        }
      );
      
      const images = response.data.results.map(photo => ({
        id: photo.id,
        thumbUrl: photo.urls.thumb,
        regularUrl: photo.urls.regular,
        fullUrl: photo.urls.full,
        description: photo.description || photo.alt_description,
        photographer: photo.user.name
      }));
      
      return { success: true, images, query: keywords, provider: 'unsplash' };
    } catch (e) {
      console.error('Unsplash 搜尋失敗:', e.message);
    }
  }
  
  return {
    success: true,
    mode: 'demo',
    query: keywords,
    images: getMockSceneImages()
  };
});

// ========== 輔助函數 ==========

// 尺寸轉換
function convertSize(value, fromUnit, toUnit) {
  if (!value) return 0;
  const v = parseFloat(value);
  if (fromUnit === toUnit) return v;
  
  // 先轉換為 cm
  let cm = v;
  if (fromUnit === 'sqft') cm = Math.sqrt(v * 929);
  else if (fromUnit === 'sqm') cm = Math.sqrt(v * 10000);
  
  // 再轉換為目標單位
  if (toUnit === 'sqft') return (cm * cm) / 929;
  if (toUnit === 'sqm') return (cm * cm) / 10000;
  return cm;
}

// 推薦適用房間
function getRecommendedRooms(material, style) {
  const materialRooms = {
    '瓷磚': ['bathroom', 'kitchen', 'balcony'],
    '石材': ['living room', 'bathroom', 'entrance'],
    '木材': ['bedroom', 'study', 'living room'],
    '馬賽克': ['bathroom', 'kitchen', 'pool'],
    '水泥': ['studio', 'balcony', 'garage']
  };
  
  const styleRooms = TILE_STYLES[style]?.rooms || ['living room'];
  
  // 合併並去重
  const combined = [...new Set([...(materialRooms[material] || []), ...styleRooms])];
  return combined.slice(0, 4);
}

// 推薦場景風格
function getRecommendedStyles(color, material, pattern) {
  const styles = [];
  
  // 根據顏色推薦
  if (color) {
    if (color.includes('白') || color.includes('淺')) {
      styles.push('現代簡約', '北歐自然');
    } else if (color.includes('深') || color.includes('黑')) {
      styles.push('工業Loft', '奢華古典');
    } else if (color.includes('木') || color.includes('棕')) {
      styles.push('北歐自然', '日式禪風');
    } else if (color.includes('藍')) {
      styles.push('地中海', '現代簡約');
    }
  }
  
  // 根據材質推薦
  if (material === '石材') styles.push('奢華古典');
  if (material === '木材') styles.push('北歐自然', '日式禪風');
  if (material === '水泥') styles.push('工業Loft');
  
  // 去重並限制數量
  return [...new Set(styles)].slice(0, 4);
}

// 生成推薦
function generateRecommendations(analysis) {
  const { color, material, pattern, style, recommendedRooms, recommendedStyles } = analysis;
  
  return {
    bestMatch: {
      room: recommendedRooms[0] || 'living room',
      style: recommendedStyles[0] || '現代簡約',
      reason: `根據您的 ${color} ${material} ${pattern} 磁磚，${recommendedStyles[0]} 風格最能展現其特色`
    },
    alternatives: recommendedStyles.slice(1, 3).map((s, i) => ({
      room: recommendedRooms[i + 1] || recommendedRooms[0],
      style: s,
      reason: `${s} 風格能創造不同的氛圍`
    })),
    allRooms: recommendedRooms,
    allStyles: recommendedStyles
  };
}

// 建立進階 prompt
function buildAdvancedPrompt(analysis, roomType, style) {
  const { color, material, pattern } = analysis;
  const styleInfo = TILE_STYLES[style] || TILE_STYLES['現代簡約'];
  
  const roomDescriptions = {
    'living room': 'modern living room interior with sofa and natural lighting',
    'bedroom': 'cozy bedroom interior with warm ambient lighting',
    'bathroom': 'modern bathroom interior with clean design',
    'kitchen': 'modern kitchen interior with bright lighting',
    'dining room': 'elegant dining room interior with dining table',
    'balcony': 'outdoor balcony with city view',
    'study': 'modern study room with bookshelves',
    'entrance': 'modern entrance hall with elegant design'
  };
  
  const roomDesc = roomDescriptions[roomType] || `beautiful ${roomType}`;
  
  // ControlNet prompt：結合風格關鍵詞
  const styleKeywords = styleInfo.keywords.join(', ');
  
  return `${roomDesc}, ${style} style, ${styleKeywords}, ${styleInfo.mood} atmosphere, ${pattern} tile floor from reference, interior design, professional photography, 8k, high quality, realistic`;
}

function buildSearchKeywords(color, material, roomType) {
  const roomKeywords = { '浴室': 'bathroom', '廚房': 'kitchen', '客廳': 'living room', '臥室': 'bedroom', '陽台': 'balcony' };
  const materialKeywords = { '瓷磚': 'tile', '石材': 'stone', '木材': 'wood', '馬賽克': 'mosaic', '水泥': 'concrete' };
  const colorKeywords = { '淺灰': 'light gray', '深灰': 'dark gray', '米白': 'beige', '白色': 'white', '黑色': 'black' };
  
  const parts = [];
  if (roomType) parts.push(roomKeywords[roomType] || roomType);
  if (material) parts.push(materialKeywords[material] || material);
  if (color) parts.push(colorKeywords[color] || color);
  parts.push('interior', 'tile');
  return parts.join(' ');
}

function getMockSceneImages() {
  return [
    { id: 'mock1', thumbUrl: 'https://placehold.co/200x150/e8e4dc/666?text=Scene+1', regularUrl: 'https://placehold.co/800x600/e8e4dc/666?text=Scene+1', description: '模擬場景 1', photographer: 'Demo' }
  ];
}

// 啟動伺服器
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('🚀 磁磚場景系統 v4.0 已啟動: http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
