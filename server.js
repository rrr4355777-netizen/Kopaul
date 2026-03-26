// 環境變數
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

// ========== API 路由 ==========

// 0. API 狀態檢查
fastify.get('/api/status', async (request, reply) => {
  return {
    success: true,
    apiKeys: {
      replicate: !!process.env.REPLICATE_API_TOKEN
    },
    server: { version: '2.1.0', uptime: process.uptime() }
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

// 2. AI 分析磁磚特徵
fastify.post('/api/analyze', async (request, reply) => {
  const { tilePath, width, height, sizeUnit, color, material } = request.body;
  
  if (!tilePath) {
    return reply.code(400).send({ error: '缺少磁磚圖片路徑' });
  }

  // 轉換尺寸為 CM（統一方面積計算）
  let widthCm = parseFloat(width) || 0;
  let heightCm = parseFloat(height) || 0;
  
  if (sizeUnit === 'sqft') {
    // 平方尺 → cm（1平方尺 = 30.48cm × 30.48cm ≈ 929cm²）
    widthCm = Math.sqrt(parseFloat(width) * 929);
    heightCm = Math.sqrt(parseFloat(height) * 929);
  } else if (sizeUnit === 'sqm') {
    // 平方米 → cm（1平方米 = 100cm × 100cm）
    widthCm = Math.sqrt(parseFloat(width) * 10000);
    heightCm = Math.sqrt(parseFloat(height) * 10000);
  }

  let detectedColor = color;
  
  // 使用 OpenAI Vision 分析圖片顏色（如果沒有指定顏色）
  if (!color && process.env.OPENAI_API_KEY) {
    try {
      const imageUrl = `http://localhost:3000${tilePath}`;
      const visionResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this tile main color in 2 Chinese words. Examples: 淺灰色, 米白色, 深棕色, 白色, 黑色, 藍色, 綠色. Just reply with the color name.' },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }],
          max_tokens: 20
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const result = visionResponse.data.choices[0].message.content.trim();
      // 嘗試匹配顏色選項
      const colorMap = {
        '淺灰': '淺灰', '淺灰色': '淺灰', 'light gray': '淺灰',
        '深灰': '深灰', '深灰色': '深灰', 'dark gray': '深灰',
        '米白': '米白', '米白色': '米白', 'beige': '米白',
        '淺棕': '淺棕', '淺棕色': '淺棕', 'light brown': '淺棕',
        '深棕': '深棕', '深棕色': '深棕', 'dark brown': '深棕',
        '白': '白色', '白色': '白色', 'white': '白色',
        '黑': '黑色', '黑色': '黑色', 'black': '黑色',
        '藍': '藍色', '藍色': '藍色', 'blue': '藍色',
        '綠': '綠色', '綠色': '綠色', 'green': '綠色'
      };
      
      for (const [key, value] of Object.entries(colorMap)) {
        if (result.includes(key)) {
          detectedColor = value;
          break;
        }
      }
    } catch (e) {
      console.log('顏色辨識失敗:', e.message);
    }
  }

  const features = {
    pattern: detectPattern(color || detectedColor, material),
    style: inferStyle(material),
    mood: inferMood(color || detectedColor, material),
    recommendedRooms: getRecommendedRooms(material),
    detectedColor: detectedColor
  };
  
  return { success: true, features, tileInfo: { width, height, color: detectedColor, material } };
});

// 3. 生成場景模擬圖
fastify.post('/api/generate', async (request, reply) => {
  const { tilePath, features, roomType = 'living room' } = request.body;
  
  if (!tilePath || !features) {
    return reply.code(400).send({ error: '缺少必要參數' });
  }

  try {
    const prompt = buildScenePrompt(features, roomType);
    
    // === 主要方案：Replicate ===
    if (process.env.REPLICATE_API_TOKEN) {
      // 使用 OpenAI Vision 分析圖片顏色
      if (process.env.OPENAI_API_KEY && tilePath) {
        try {
          const imageUrl = `http://localhost:3000${tilePath}`;
          const visionResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model: 'gpt-4o-mini',
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: 'Describe this tile in 2 words: what is the main color? Reply in Chinese. Examples: "淺灰色", "米白色", "深棕色"' },
                  { type: 'image_url', image_url: { url: imageUrl } }
                ]
              }],
              max_tokens: 50
            },
            {
              headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          );
          const detectedColor = visionResponse.data.choices[0].message.content;
          // 更新 features 中的顏色
          features.detectedColor = detectedColor;
        } catch (e) {
          console.log('顏色辨識失敗:', e.message);
        }
      }
      
      const versionId = 'c846a69991daf4c0e5d016514849d14ee5b2e6846ce6b9d6f21369e564cfe51e';
      
      const response = await axios.post(
        'https://api.replicate.com/v1/predictions',
        {
          version: versionId,
          input: { prompt: prompt, go_fast: true, num_outputs: 1, aspect_ratio: '16:9' }
        },
        {
          headers: {
            'Authorization': 'Token ' + process.env.REPLICATE_API_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const result = response.data;
      
      // 等待生成完成（最多 30 秒）
      if (result.status === 'succeeded') {
        return { success: true, imageUrl: result.output[0], prompt: prompt, provider: 'replicate' };
      } else if (result.status === 'failed') {
        return reply.code(500).send({ error: 'AI 生成失敗', detail: result.error });
      } else {
        // 輪詢等待結果
        let attempts = 0;
        while (attempts < 15) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const check = await axios.get(result.urls.get, {
              headers: { 'Authorization': 'Token ' + process.env.REPLICATE_API_TOKEN }
            });
            if (check.data.status === 'succeeded') {
              return { success: true, imageUrl: check.data.output[0], prompt: prompt, provider: 'replicate' };
            } else if (check.data.status === 'failed') {
              return reply.code(500).send({ error: 'AI 生成失敗' });
            }
          } catch (e) { break; }
          attempts++;
        }
        return reply.code(500).send({ error: 'AI 生成逾時' });
      }
    }
    
    // Demo 模式
    return {
      success: true,
      message: 'demo mode',
      prompt: prompt,
      imageUrl: 'https://placehold.co/800x600/e8e4dc/666?text=Tile+Scene+Preview',
      provider: 'demo'
    };
  } catch (error) {
    console.error('生成失敗:', error.message);
    return reply.code(500).send({ error: '場景生成失敗: ' + error.message });
  }
});

// 4. 搜尋相似場景
fastify.post('/api/search-scenes', async (request, reply) => {
  const { color, material, roomType } = request.body;
  const keywords = buildSearchKeywords(color, material, roomType);
  
  // Unsplash API
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
        photographer: photo.user.name,
        photographerUrl: photo.user.links.html
      }));
      
      return { success: true, images, query: keywords, provider: 'unsplash' };
    } catch (e) {
      console.error('Unsplash 搜尋失敗:', e.message);
    }
  }
  
  // Demo 模式
  return {
    success: true,
    mode: 'demo',
    query: keywords,
    images: getMockSceneImages(color, material, roomType)
  };
});

// ========== 輔助函數 ==========

function detectPattern(color, material) {
  // 基於顏色和材質推斷圖案類型
  if (material === '石材') return '大理石紋';
  if (material === '木材') return '木紋';
  if (material === '馬賽克') return '馬賽克';
  if (material === '水泥') return '水泥紋';
  
  // 基於顏色推斷
  if (color) {
    const c = color.toLowerCase();
    if (c.includes('深') || c.includes('黑')) return '大理石紋';
    if (c.includes('淺') || c.includes('米') || c.includes('白')) return '純色';
  }
  return '幾何';
}

function inferStyle(material) {
  const styles = { '瓷磚': '現代簡約', '石材': '自然鄉村', '木材': '北歐風', '馬賽克': '復古華麗', '水泥': '工業風' };
  return styles[material] || '現代簡約';
}

function inferMood(material) {
  const moods = { '瓷磚': '清新明亮', '石材': '沉穩大氣', '木材': '溫暖舒適', '馬賽克': '繽紛活潑', '水泥': '冷冽前衛' };
  return moods[material] || '溫馨舒適';
}

function getRecommendedRooms(material) {
  const rooms = { '瓷磚': ['浴室', '廚房', '陽台'], '石材': ['客廳', '大堂', '浴室'], '木材': ['臥室', '書房', '客廳'], '馬賽克': ['浴室', '廚房', '泳池'], '水泥': ['車庫', '陽台', '工作室'] };
  return rooms[material] || ['客廳', '浴室', '廚房'];
}

function buildScenePrompt(features, roomType) {
  const { pattern, style, mood, detectedColor } = features;
  const colorPart = detectedColor ? `${detectedColor}` : '';
  return `A ${roomType} interior with ${colorPart} ${pattern} ${style} tile flooring, ${mood} atmosphere, realistic interior photo, high quality, 8k, detailed tiles on floor`;
}

function buildSearchKeywords(color, material, roomType) {
  const roomKeywords = { '浴室': 'bathroom', '廚房': 'kitchen', '客廳': 'living room', '臥室': 'bedroom', '餐廳': 'dining room', '陽台': 'balcony' };
  const materialKeywords = { '瓷磚': 'tile', '石材': 'stone', '木材': 'wood', '馬賽克': 'mosaic', '水泥': 'concrete' };
  const colorKeywords = { '淺灰': 'light gray', '深灰': 'dark gray', '米白': 'beige', '淺棕': 'light brown', '深棕': 'dark brown', '白色': 'white', '黑色': 'black', '藍色': 'blue', '綠色': 'green' };
  
  const parts = [];
  if (roomType) parts.push(roomKeywords[roomType] || roomType);
  if (material) parts.push(materialKeywords[material] || material);
  if (color) parts.push(colorKeywords[color] || color);
  parts.push('interior', 'tile');
  return parts.join(' ');
}

function getMockSceneImages() {
  return [
    { id: 'mock1', thumbUrl: 'https://placehold.co/200x150/e8e4dc/666?text=Scene+1', regularUrl: 'https://placehold.co/800x600/e8e4dc/666?text=Scene+1', description: '模擬場景 1', photographer: 'Demo' },
    { id: 'mock2', thumbUrl: 'https://placehold.co/200x150/d4c4b0/555?text=Scene+2', regularUrl: 'https://placehold.co/800x600/d4c4b0/555?text=Scene+2', description: '模擬場景 2', photographer: 'Demo' },
    { id: 'mock3', thumbUrl: 'https://placehold.co/200x150/c9b89d/444?text=Scene+3', regularUrl: 'https://placehold.co/800x600/c9b89d/444?text=Scene+3', description: '模擬場景 3', photographer: 'Demo' },
    { id: 'mock4', thumbUrl: 'https://placehold.co/200x150/bfae8c/333?text=Scene+4', regularUrl: 'https://placehold.co/800x600/bfae8c/333?text=Scene+4', description: '模擬場景 4', photographer: 'Demo' },
    { id: 'mock5', thumbUrl: 'https://placehold.co/200x150/b4a07b/222?text=Scene+5', regularUrl: 'https://placehold.co/800x600/b4a07b/222?text=Scene+5', description: '模擬場景 5', photographer: 'Demo' },
    { id: 'mock6', thumbUrl: 'https://placehold.co/200x150/a9966a/111?text=Scene+6', regularUrl: 'https://placehold.co/800x600/a9966a/111?text=Scene+6', description: '模擬場景 6', photographer: 'Demo' }
  ];
}

// 啟動伺服器
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('🚀 磁磚場景系統 v2.1 已啟動: http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();