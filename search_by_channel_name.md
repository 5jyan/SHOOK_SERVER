# Feature Development Task List: YouTube Channel Search

## Backend Tasks
- [x] **Dependency**: Install `googleapis` package.
- [x] **API Route**: Create a new route for channel search in `server/api/channels.ts`.
- [x] **Service Logic**: Implement the channel search logic in `server/services/channel-service.ts`.
- [x] **Routing**: Add the new search route to the main API router `server/api/index.ts`.

## Frontend Tasks
- [x] **Custom Hook**: Create `client/src/hooks/use-channel-search.ts` for search logic.
- [x] **Debounce Hook**: Create `client/src/hooks/use-debounce.ts` to prevent excessive API calls.
- [x] **API Service**: Update `client/src/services/api.ts` with a function to call the new search endpoint.
- [x] **UI Component**: Modify `client/src/components/channel-form.tsx` to include a search input and display results.
- [x] **UI Component**: Implement a dropdown menu to show search results.

---

# YouTube Channel Search by Name - 상세 구현 가이드

## 📋 프로젝트 개요

기존의 @handler 입력 방식에서 채널명으로 검색 후 선택할 수 있는 기능으로 개선하는 프로젝트입니다.

### 현재 상태 → 목표 상태
- **현재**: 사용자가 직접 @handler를 찾아서 입력해야 함
- **목표**: 채널명 입력 → 검색 결과 드롭다운 → 클릭으로 선택

---

## 🏗️ 2단계: 백엔드 구현

### 2.1 프로젝트 구조
```
backend/
├── src/
│   ├── controllers/
│   │   └── channelController.js
│   ├── middleware/
│   │   ├── rateLimiter.js
│   │   ├── validator.js
│   │   └── errorHandler.js
│   ├── services/
│   │   └── youtubeService.js
│   ├── routes/
│   │   └── channels.js
│   └── utils/
│       └── logger.js
├── app.js
└── server.js
```

### 2.2 서버 설정 (app.js)

```javascript
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// 보안 미들웨어
app.use(helmet());

// CORS 설정
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate Limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW_MS) / 1000)
  }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
const channelRoutes = require('./src/routes/channels');
app.use('/api/channels', channelRoutes);

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global Error:', error);
  res.status(error.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message
  });
});

module.exports = app;
```

### 2.3 YouTube API 서비스 (youtubeService.js)

```javascript
const { google } = require('googleapis');

class YouTubeService {
  constructor() {
    this.youtube = google.youtube({
      version: 'v3',
      auth: process.env.YOUTUBE_API_KEY
    });
    this.quotaUsed = 0;
    this.quotaLimit = parseInt(process.env.YOUTUBE_API_QUOTA_LIMIT) || 10000;
  }

  async searchChannels(query, maxResults = 10) {
    try {
      // 할당량 체크
      if (this.quotaUsed >= this.quotaLimit) {
        throw new Error('YouTube API quota exceeded');
      }

      // 1차 검색 (채널 기본 정보)
      const searchResponse = await this.youtube.search.list({
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: Math.min(maxResults, 50), // YouTube API 최대 50개
        order: 'relevance',
        safeSearch: 'moderate'
      });

      this.quotaUsed += 100; // search.list cost = 100 units

      if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
        return [];
      }

      // 2차 검색 (채널 상세 정보)
      const channelIds = searchResponse.data.items.map(item => item.snippet.channelId);
      const channelsResponse = await this.youtube.channels.list({
        part: 'snippet,statistics',
        id: channelIds.join(','),
        maxResults: 50
      });

      this.quotaUsed += 1; // channels.list cost = 1 unit

      // 데이터 병합 및 가공
      const enhancedChannels = this.mergeChannelData(
        searchResponse.data.items,
        channelsResponse.data.items
      );

      return enhancedChannels;

    } catch (error) {
      console.error('YouTube API Error:', error);
      
      if (error.code === 403) {
        throw new Error('YouTube API quota exceeded or invalid key');
      } else if (error.code === 400) {
        throw new Error('Invalid search query');
      }
      
      throw new Error('YouTube API request failed');
    }
  }

  mergeChannelData(searchItems, channelItems) {
    return searchItems.map(searchItem => {
      const channelDetail = channelItems.find(
        channel => channel.id === searchItem.snippet.channelId
      );

      return {
        channelId: searchItem.snippet.channelId,
        channelTitle: searchItem.snippet.channelTitle,
        description: searchItem.snippet.description || '',
        thumbnail: searchItem.snippet.thumbnails?.default?.url || '',
        customUrl: channelDetail?.snippet?.customUrl || '',
        subscriberCount: this.parseSubscriberCount(
          channelDetail?.statistics?.subscriberCount || '0'
        ),
        videoCount: channelDetail?.statistics?.videoCount || '0',
        publishedAt: searchItem.snippet.publishedAt
      };
    });
  }

  parseSubscriberCount(count) {
    const num = parseInt(count);
    if (isNaN(num)) return '0';
    return num.toString();
  }

  async getChannelById(channelId) {
    try {
      const response = await this.youtube.channels.list({
        part: 'snippet,statistics',
        id: channelId
      });

      this.quotaUsed += 1;

      if (!response.data.items || response.data.items.length === 0) {
        return null;
      }

      const channel = response.data.items[0];
      return {
        channelId: channel.id,
        channelTitle: channel.snippet.title,
        description: channel.snippet.description || '',
        customUrl: channel.snippet.customUrl || '',
        thumbnail: channel.snippet.thumbnails?.default?.url || '',
        subscriberCount: channel.statistics.subscriberCount || '0',
        videoCount: channel.statistics.videoCount || '0'
      };

    } catch (error) {
      console.error('Get Channel Error:', error);
      throw new Error('Failed to get channel information');
    }
  }

  getQuotaUsage() {
    return {
      used: this.quotaUsed,
      limit: this.quotaLimit,
      remaining: this.quotaLimit - this.quotaUsed
    };
  }
}

module.exports = new YouTubeService();
```

### 2.4 입력값 검증 미들웨어 (validator.js)

```javascript
const Joi = require('joi');

const searchValidation = Joi.object({
  query: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-Z0-9가-힣\s\-_.]+$/)
    .required()
    .messages({
      'string.min': '검색어는 최소 2글자 이상이어야 합니다.',
      'string.max': '검색어는 100글자를 초과할 수 없습니다.',
      'string.pattern.base': '유효하지 않은 문자가 포함되어 있습니다.',
      'any.required': '검색어를 입력해주세요.'
    }),
  maxResults: Joi.number()
    .integer()
    .min(1)
    .max(50)
    .default(10)
});

const registerValidation = Joi.object({
  channelId: Joi.string()
    .pattern(/^UC[a-zA-Z0-9_-]{22}$/)
    .required()
    .messages({
      'string.pattern.base': '유효하지 않은 채널 ID입니다.',
      'any.required': '채널 ID는 필수입니다.'
    }),
  userId: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      'any.required': '사용자 ID는 필수입니다.'
    })
});

const validateSearch = (req, res, next) => {
  const { error, value } = searchValidation.validate(req.query);
  
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    });
  }
  
  req.validatedQuery = value;
  next();
};

const validateRegister = (req, res, next) => {
  const { error, value } = registerValidation.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    });
  }
  
  req.validatedBody = value;
  next();
};

module.exports = {
  validateSearch,
  validateRegister
};
```

### 2.5 컨트롤러 (channelController.js)

```javascript
const youtubeService = require('../services/youtubeService');

class ChannelController {
  async searchChannels(req, res, next) {
    try {
      const { query, maxResults } = req.validatedQuery;

      console.log(`Searching channels for: "${query}"`);

      const channels = await youtubeService.searchChannels(query, maxResults);

      // 할당량 정보도 함께 반환 (개발 환경에서만)
      const response = {
        success: true,
        channels,
        count: channels.length
      };

      if (process.env.NODE_ENV === 'development') {
        response.quotaUsage = youtubeService.getQuotaUsage();
      }

      res.json(response);

    } catch (error) {
      console.error('Search channels error:', error);
      
      if (error.message.includes('quota')) {
        return res.status(429).json({
          success: false,
          error: 'API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.'
        });
      }

      next(error);
    }
  }

  async registerChannel(req, res, next) {
    try {
      const { channelId, userId } = req.validatedBody;

      console.log(`Registering channel ${channelId} for user ${userId}`);

      // 채널 존재 여부 확인
      const channelInfo = await youtubeService.getChannelById(channelId);
      
      if (!channelInfo) {
        return res.status(404).json({
          success: false,
          error: '채널을 찾을 수 없습니다.'
        });
      }

      // 여기서 실제 데이터베이스에 저장
      // TODO: Database integration
      const savedChannel = {
        ...channelInfo,
        userId,
        registeredAt: new Date().toISOString()
      };

      console.log('Channel registered successfully:', savedChannel.channelTitle);

      res.status(201).json({
        success: true,
        message: '채널이 성공적으로 등록되었습니다.',
        channel: savedChannel
      });

    } catch (error) {
      console.error('Register channel error:', error);
      next(error);
    }
  }
}

module.exports = new ChannelController();
```

### 2.6 라우터 (routes/channels.js)

```javascript
const express = require('express');
const channelController = require('../controllers/channelController');
const { validateSearch, validateRegister } = require('../middleware/validator');

const router = express.Router();

// 채널 검색
router.get('/search', validateSearch, channelController.searchChannels);

// 채널 등록
router.post('/register', validateRegister, channelController.registerChannel);

// 할당량 확인 (개발용)
if (process.env.NODE_ENV === 'development') {
  const youtubeService = require('../services/youtubeService');
  
  router.get('/quota', (req, res) => {
    res.json({
      success: true,
      quota: youtubeService.getQuotaUsage()
    });
  });
}

module.exports = router;
```

---

## 🎨 3단계: 프론트엔드 구현

### 3.1 프로젝트 구조 (React)
```
src/
├── components/
│   ├── ChannelSearch/
│   │   ├── index.js
│   │   ├── ChannelSearch.jsx
│   │   ├── ChannelSearch.module.css
│   │   ├── SearchInput.jsx
│   │   ├── ChannelDropdown.jsx
│   │   ├── ChannelItem.jsx
│   │   └── SelectedChannel.jsx
│   └── common/
│       ├── LoadingSpinner.jsx
│       └── ErrorMessage.jsx
├── hooks/
│   ├── useChannelSearch.js
│   ├── useDebounce.js
│   └── useClickOutside.js
├── services/
│   └── channelService.js
├── utils/
│   ├── formatters.js
│   └── constants.js
└── styles/
    └── global.css
```

### 3.2 API 서비스 (channelService.js)

```javascript
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Axios 인스턴스 생성
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 요청 인터셉터
apiClient.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('Request Error:', error);
    return Promise.reject(error);
  }
);

// 응답 인터셉터
apiClient.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    console.error('API Error:', error);
    
    if (error.code === 'ECONNABORTED') {
      throw new Error('요청 시간이 초과되었습니다. 다시 시도해주세요.');
    }
    
    if (error.response?.status === 429) {
      throw new Error('너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
    
    if (error.response?.data?.error) {
      throw new Error(error.response.data.error);
    }
    
    throw new Error('네트워크 오류가 발생했습니다.');
  }
);

export const channelService = {
  async searchChannels(query, maxResults = 10) {
    const params = new URLSearchParams({
      query: query.trim(),
      maxResults: maxResults.toString()
    });

    return await apiClient.get(`/channels/search?${params}`);
  },

  async registerChannel(channelId, userId) {
    return await apiClient.post('/channels/register', {
      channelId,
      userId
    });
  },

  // 개발용 할당량 확인
  async getQuotaUsage() {
    if (process.env.NODE_ENV === 'development') {
      return await apiClient.get('/channels/quota');
    }
    return null;
  }
};
```

### 3.3 커스텀 훅 (useChannelSearch.js)

```javascript
import { useState, useCallback, useRef } from 'react';
import { channelService } from '../services/channelService';
import { useDebounce } from './useDebounce';

export const useChannelSearch = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [channels, setChannels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedChannel, setSelectedChannel] = useState(null);
  
  const abortControllerRef = useRef(null);
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // 검색 함수
  const searchChannels = useCallback(async (query) => {
    if (!query || query.trim().length < 2) {
      setChannels([]);
      setError('');
      return;
    }

    // 이전 요청 취소
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 새로운 AbortController 생성
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setError('');

    try {
      const response = await channelService.searchChannels(query, 8);
      
      setChannels(response.channels || []);
      
      if (response.channels?.length === 0) {
        setError('검색 결과가 없습니다. 다른 키워드로 시도해보세요.');
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        // 요청이 취소된 경우 무시
        return;
      }
      
      console.error('Search error:', error);
      setError(error.message || '검색 중 오류가 발생했습니다.');
      setChannels([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 채널 등록 함수
  const registerChannel = useCallback(async (channelId, userId) => {
    setIsLoading(true);
    setError('');

    try {
      const response = await channelService.registerChannel(channelId, userId);
      return response;
    } catch (error) {
      console.error('Registration error:', error);
      setError(error.message || '채널 등록 중 오류가 발생했습니다.');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 검색어 변경 시 자동 검색
  React.useEffect(() => {
    if (debouncedSearchTerm) {
      searchChannels(debouncedSearchTerm);
    }
  }, [debouncedSearchTerm, searchChannels]);

  // 컴포넌트 언마운트 시 요청 취소
  React.useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    searchTerm,
    setSearchTerm,
    channels,
    isLoading,
    error,
    selectedChannel,
    setSelectedChannel,
    registerChannel,
    clearSearch: () => {
      setSearchTerm('');
      setChannels([]);
      setError('');
      setSelectedChannel(null);
    }
  };
};
```

### 3.4 디바운스 훅 (useDebounce.js)

```javascript
import { useState, useEffect } from 'react';

export const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};
```

### 3.5 외부 클릭 감지 훅 (useClickOutside.js)

```javascript
import { useEffect, useRef } from 'react';

export const useClickOutside = (callback) => {
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        callback();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [callback]);

  return ref;
};
```

---

## 🛠️ 1단계: 프로젝트 환경 설정

### 1.1 필수 패키지 및 버전 (2024년 최신)

#### 백엔드 (Node.js/Express)
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "googleapis": "^129.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.1.5",
    "joi": "^17.11.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

#### 프론트엔드 (React)
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "axios": "^1.6.2"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.8"
  }
}
```

### 1.2 라이브러리 선택 이유 및 주의사항

| 라이브러리 | 버전 | 선택 이유 | 주의사항 |
|-----------|------|-----------|----------|
| googleapis | ^129.0.0 | Google 공식 라이브러리, 최신 YouTube API v3 지원 | API 할당량 관리 필수 |
| helmet | ^7.1.0 | 보안 헤더 자동 설정 | production 환경에서 필수 |
| express-rate-limit | ^7.1.5 | API 호출 제한으로 악용 방지 | 개발 중에는 비활성화 |
| joi | ^17.11.0 | 입력값 검증 라이브러리 | 타입스크립트 대안으로 zod 고려 가능 |
| axios | ^1.6.2 | fetch보다 풍부한 기능 | fetch API로 대체 가능 |

### 1.3 환경변수 설정

#### `.env` 파일 (백엔드)
```env
# YouTube API
YOUTUBE_API_KEY=your_youtube_api_key_here
YOUTUBE_API_QUOTA_LIMIT=10000

# Server Configuration
PORT=5000
NODE_ENV=development

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

#### 주의사항
- ⚠️ `.env` 파일은 절대 Git에 커밋하지 않기
- ⚠️ production 환경에서는 환경변수를 서버 설정으로 관리
- ⚠️ YouTube API 키는 IP/도메인 제한 설정 권장

---

## ⚠️ 주의사항 및 베스트 프랙티스

### 4.1 보안 고려사항

1. **API 키 보안**
   - 환경변수로 관리
   - 클라이언트에 노출 금지
   - IP/도메인 제한 설정

2. **입력값 검증**
   - 서버 사이드 검증 필수
   - XSS 방지를 위한 입력값 sanitization
   - SQL injection 방지 (DB 사용 시)

3. **Rate Limiting**
   - API 호출 횟수 제한
   - 사용자별 제한 설정
   - 악용 방지

### 4.2 성능 최적화

1. **API 호출 최적화**
   - 디바운싱으로 불필요한 호출 방지
   - 요청 취소 (AbortController) 구현
   - 결과 캐싱 고려

2. **프론트엔드 최적화**
   - React.memo로 불필요한 리렌더링 방지
   - useMemo, useCallback 적절히 사용
   - 이미지 레이지 로딩

3. **번들 크기 최적화**
   - Tree shaking 확인
   - 불필요한 라이브러리 제거
   - Code splitting 고려

### 4.3 에러 처리

1. **YouTube API 에러**
   - 할당량 초과 처리
   - 네트워크 오류 처리
   - 타임아웃 처리

2. **사용자 친화적 메시지**
   - 구체적이고 이해하기 쉬운 에러 메시지
   - 해결 방법 제시
   - 재시도 옵션 제공

### 4.4 접근성 (Accessibility)

1. **키보드 네비게이션**
   - 드롭다운 항목 키보드로 선택 가능
   - Tab, Enter, Escape 키 지원

2. **스크린 리더 지원**
   - aria-label, aria-describedby 적절히 사용
   - role 속성 설정

3. **시각적 접근성**
   - 충분한 색상 대비
   - 포커스 표시
   - 로딩 상태 명확히 표시

### 4.5 테스트 고려사항

1. **단위 테스트**
   - 유틸리티 함수 테스트
   - 커스텀 훅 테스트
   - API 서비스 테스트

2. **통합 테스트**
   - API 엔드포인트 테스트
   - 사용자 플로우 테스트

3. **E2E 테스트**
   - 전체 검색 플로우 테스트
   - 에러 케이스 테스트

---

## 📊 모니터링 및 로깅

### 5.1 로깅 전략

```javascript
// 백엔드 로깅
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

### 5.2 메트릭 수집

- API 응답 시간
- 검색 요청 횟수
- 등록 성공/실패율
- YouTube API 할당량 사용량

---

## 🚀 배포 준비

### 6.1 환경별 설정

#### Development
```env
NODE_ENV=development
YOUTUBE_API_KEY=dev_key
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

#### Production
```env
NODE_ENV=production
YOUTUBE_API_KEY=prod_key
ALLOWED_ORIGINS=https://yourdomain.com
```

### 6.2 Docker 설정 (선택사항)

```dockerfile
# Dockerfile (백엔드)
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
```

---

## 📚 추가 학습 자료

1. **YouTube Data API v3 공식 문서**
   - https://developers.google.com/youtube/v3

2. **React 성능 최적화**
   - https://react.dev/learn/render-and-commit

3. **Express.js 보안 가이드**
   - https://expressjs.com/en/advanced/best-practice-security.html

4. **Node.js 성능 모니터링**
   - https://nodejs.org/en/docs/guides/simple-profiling

---

이 문서를 통해 각 단계별로 체계적으로 구현하시면 안정적이고 확장 가능한 YouTube 채널 검색 기능을 완성할 수 있습니다.
