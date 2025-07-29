# YouTube 채널 모니터링 & Slack 알림 시스템 - 프로젝트 인수인계 문서

## 📋 목차
1. [프로젝트 개요](#프로젝트-개요)
2. [기술 스택](#기술-스택)
3. [시스템 아키텍처](#시스템-아키텍처)
4. [주요 기능](#주요-기능)
5. [데이터베이스 스키마](#데이터베이스-스키마)
6. [API 설계](#api-설계)
7. [외부 서비스 연동](#외부-서비스-연동)
8. [배포 및 환경 설정](#배포-및-환경-설정)
9. [중요 개발 가이드라인](#중요-개발-가이드라인)
10. [문제 해결 및 디버깅](#문제-해결-및-디버깅)
11. [성능 및 제한사항](#성능-및-제한사항)
12. [향후 개선 사항](#향후-개선-사항)

---

## 🎯 프로젝트 개요

### 목적
YouTube 채널을 모니터링하여 새로운 영상이 업로드될 때 자동으로 자막을 추출하고, AI를 활용해 요약을 생성한 후 사용자의 개인 Slack 채널로 알림을 전송하는 시스템

### 핵심 워크플로우
1. **사용자 등록** → YouTube 채널 추가 → Slack 워크스페이스 초대
2. **백그라운드 모니터링** → RSS 피드 확인 (5분 간격)
3. **새 영상 감지** → 자막 추출 → AI 요약 생성 → Slack 전송

### 특징
- Gmail 스타일의 깔끔한 UI 디자인
- 한국어 기반 시스템 (UI 및 요약)
- 실시간 에러 로깅 및 모니터링
- YouTube Shorts 자동 필터링
- 모듈화된 백엔드 아키텍처

---

## 🛠 기술 스택

### Frontend
- **React 18** with TypeScript
- **Vite** (번들러 및 개발 서버)
- **Tailwind CSS** (스타일링)
- **Shadcn/ui** (UI 컴포넌트 라이브러리)
- **TanStack Query** (서버 상태 관리)
- **Wouter** (클라이언트 라우팅)
- **React Hook Form** + Zod (폼 관리 및 검증)

### Backend
- **Node.js** with TypeScript
- **Express.js** (웹 프레임워크)
- **Drizzle ORM** (데이터베이스 ORM)
- **PostgreSQL** (Neon 서버리스)
- **Passport.js** (인증)
- **Express Session** (세션 관리)

### External APIs
- **YouTube Data API v3** (채널 정보, 영상 메타데이터)
- **SupaData API** (자막 추출)
- **Anthropic Claude API** (AI 요약 생성)
- **Slack Web API** (메시지 전송, 채널 관리)

### Development Tools
- **tsx** (TypeScript 실행)
- **esbuild** (프로덕션 빌드)
- **Drizzle Kit** (데이터베이스 마이그레이션)

---

## 🏗 시스템 아키텍처

### 디렉토리 구조
```
├── client/                 # React 프론트엔드
│   ├── src/
│   │   ├── components/     # 재사용 가능한 컴포넌트
│   │   ├── pages/         # 페이지 컴포넌트
│   │   ├── hooks/         # 커스텀 React 훅
│   │   ├── services/      # API 서비스 레이어
│   │   └── lib/           # 유틸리티 및 설정
│   └── ...
├── server/                # Express 백엔드
│   ├── routes/           # API 엔드포인트 (모듈별)
│   ├── services/         # 비즈니스 로직
│   ├── utils/            # 공통 유틸리티
│   ├── index.ts          # 서버 진입점
│   ├── storage.ts        # 데이터베이스 레이어
│   ├── youtube-monitor.ts # YouTube 모니터링 로직
│   └── youtube-summary.ts # AI 요약 서비스
├── shared/               # 공통 타입 및 스키마
│   └── schema.ts         # Drizzle 스키마 정의
└── ...
```

### 모듈화된 백엔드 구조

#### Routes (API 엔드포인트)
- `routes/auth.ts` - 로그인/로그아웃
- `routes/channels.ts` - 채널 관리 (추가/삭제/조회)
- `routes/slack.ts` - Slack 연동 (초대/채널 생성)
- `routes/summary.ts` - 영상 요약 관련

#### Services (비즈니스 로직)
- `services/channel-service.ts` - 채널 관련 비즈니스 로직
- `services/slack-service.ts` - Slack API 래퍼
- `services/summary-service.ts` - 요약 생성 로직
- `services/error-logging-service.ts` - 중앙화된 에러 로깅

#### Utils (공통 유틸리티)
- `utils/auth-utils.ts` - 인증 미들웨어
- `utils/validation.ts` - 입력 검증 로직

---

## ⚡ 주요 기능

### 1. 사용자 인증 시스템
- **방식**: username/password 기반 로컬 인증
- **암호화**: scrypt 해싱
- **세션**: PostgreSQL 기반 세션 스토어
- **보안**: CSRF 보호, timing-safe 비교

### 2. YouTube 채널 관리
- **채널 추가**: @handle 형식으로 채널 추가
- **데이터 수집**: YouTube Data API로 채널 정보 수집
- **중복 방지**: 채널별 고유 ID 관리
- **삭제 기능**: 사용자별 채널 관리

### 3. 실시간 모니터링 시스템
- **모니터링 주기**: 5분 간격
- **감지 방식**: RSS 피드 기반
- **Shorts 필터링**: URL 패턴으로 자동 제외
- **상태 추적**: recent_video_id로 신규 영상 판별

### 4. AI 기반 자막 요약
- **자막 추출**: SupaData API 활용
- **AI 요약**: Anthropic Claude 4.0 Sonnet
- **형식**: Slack mrkdwn 형식으로 직접 생성
- **언어**: 한국어 최적화

### 5. Slack 통합
- **워크스페이스**: newsfeed-fcm6025.slack.com
- **채널 생성**: 사용자별 개인 채널 자동 생성
- **메시지 형식**: 구조화된 블록 메시지
- **에러 로깅**: debug 채널로 실시간 에러 전송

---

## 🗄 데이터베이스 스키마

### 핵심 테이블

#### users
```sql
- id (primary key)
- username (unique)
- password (scrypt hashed)
- email
- slack_user_id
- slack_channel_id
- slack_joined_at
- created_at
```

#### youtube_channels
```sql
- channel_id (primary key, YouTube 채널 ID)
- handle (@channelname)
- title, description, thumbnail
- subscriber_count, video_count
- recent_video_id (최신 영상 추적용)
- recent_video_title, video_published_at
- processed (요약 처리 여부)
- error_message, caption
- updated_at
```

#### user_channels (다대다 관계)
```sql
- id (primary key)
- user_id (foreign key → users)
- channel_id (foreign key → youtube_channels)
- created_at
```

### 주요 관계
- 사용자는 여러 채널을 구독 가능
- 채널은 여러 사용자가 구독 가능
- 채널 데이터는 중복 저장하지 않음 (정규화)

---

## 🔌 API 설계

### 인증 관련
```
POST /api/auth/login      # 로그인
POST /api/auth/logout     # 로그아웃
GET  /api/user           # 현재 사용자 정보
```

### 채널 관리
```
GET    /api/channels/:userId     # 사용자 채널 목록
POST   /api/channels            # 채널 추가
DELETE /api/channels/:id        # 채널 삭제
GET    /api/channel-videos/:userId # 최신 영상 목록
```

### Slack 연동
```
POST /api/slack/invite          # Slack 워크스페이스 초대
GET  /api/slack/status/:userId  # Slack 연동 상태 확인
```

### 요약 관리
```
POST /api/summary/generate      # 수동 요약 생성
GET  /api/summary/:videoId      # 요약 조회
```

---

## 🔗 외부 서비스 연동

### 1. YouTube Data API v3
- **용도**: 채널 정보, 영상 메타데이터
- **제한**: 하루 10,000 quota
- **주요 엔드포인트**: 
  - channels (채널 정보)
  - search (채널 검색)
- **키 관리**: Google Cloud Console

### 2. SupaData API
- **용도**: YouTube 자막 추출
- **제한**: 요청량 제한 있음
- **대안**: YouTube Transcript API (향후 고려)

### 3. Anthropic Claude API
- **모델**: Claude 4.0 Sonnet
- **용도**: 한국어 영상 요약 생성
- **제한**: 크레딧 기반 과금
- **프롬프트**: Slack mrkdwn 형식 직접 생성

### 4. Slack Web API
- **Bot Token**: 워크스페이스 전체 권한
- **주요 기능**: 
  - 사용자 초대 (admin.users.invite)
  - 채널 생성 (conversations.create)
  - 메시지 전송 (chat.postMessage)

---

## 🚀 배포 및 환경 설정

### 필수 환경 변수
```bash
# 데이터베이스
DATABASE_URL=postgresql://...

# 세션 보안
SESSION_SECRET=랜덤_문자열

# YouTube API
YOUTUBE_API_KEY=구글_클라우드_콘솔_키

# Anthropic API
ANTHROPIC_API_KEY=클로드_API_키

# Slack API
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=debug_채널_ID
```

### 개발 환경 실행
```bash
npm install
npm run dev  # Vite + Express 동시 실행
```

### 프로덕션 빌드
```bash
npm run build    # 프론트엔드 빌드
npm run start    # 프로덕션 서버 실행
```

### 데이터베이스 설정
```bash
npm run db:push  # 스키마 변경사항 적용
```

---

## ⚠️ 중요 개발 가이드라인

### 1. 데이터베이스 마이그레이션
- **절대 금지**: 직접 SQL 마이그레이션 작성
- **올바른 방법**: 
  1. `shared/schema.ts` 수정
  2. `npm run db:push` 실행
  3. 데이터 손실 경고 시 수동 데이터 처리

### 2. API 사용량 관리
- **YouTube API**: quota 모니터링 필수
- **Anthropic API**: 크레딧 잔량 확인
- **SupaData API**: 429 에러 처리 로직 있음

### 3. 에러 처리
- 모든 서비스 에러는 자동으로 Slack debug 채널에 전송
- 사용자 친화적인 에러 메시지 제공
- 로그 레벨별 구분

### 4. 코드 스타일
- TypeScript 엄격 모드 사용
- Drizzle ORM 타입 안전성 활용
- React Query로 서버 상태 관리
- 폼 검증은 Zod 스키마 사용

### 5. 보안 고려사항
- API 키는 환경 변수로만 관리
- 사용자 입력은 모두 검증
- SQL 인젝션 방지 (ORM 사용)
- 세션 하이재킹 방지

---

## 🐛 문제 해결 및 디버깅

### 자주 발생하는 문제들

#### 1. YouTube API Quota 초과
```
증상: 403 Forbidden 에러
해결: Google Cloud Console에서 quota 확인/증설
```

#### 2. Anthropic API 크레딧 부족
```
증상: 400 Bad Request - credit balance too low
해결: Anthropic 콘솔에서 크레딧 충전
```

#### 3. Slack 권한 문제
```
증상: missing_scope 에러
해결: Slack App 설정에서 권한 재설정
```

#### 4. 자막 추출 실패
```
증상: SupaData API 404/429 에러
원인: 영상에 자막 없음 또는 API 제한
해결: 에러 로깅 확인, 대체 영상으로 테스트
```

### 로그 확인 방법
1. **서버 로그**: 터미널 출력
2. **Slack 에러 로그**: debug 채널 확인
3. **브라우저 콘솔**: 프론트엔드 디버깅

### 디버깅 도구
- Drizzle Studio: 데이터베이스 GUI
- React Query DevTools: 상태 모니터링
- Slack API Tester: API 응답 확인

---

## 📊 성능 및 제한사항

### 현재 제한사항
1. **동시 사용자**: 세션 기반으로 확장성 제한
2. **API 호출**: 외부 API quota에 의존
3. **자막 언어**: 한국어 주로 최적화
4. **영상 길이**: 매우 긴 영상은 요약 품질 저하 가능

### 성능 최적화 포인트
1. **데이터베이스**: 인덱스 최적화 필요
2. **캐싱**: Redis 도입 고려
3. **API 호출**: 배치 처리 최적화
4. **프론트엔드**: 가상화, 무한 스크롤 도입

### 모니터링 지표
- API 응답 시간
- 에러 발생률
- 요약 생성 성공률
- 사용자 활성도

---

## 🚧 향후 개선 사항

### 단기 개선 (1-2주)
1. **에러 복구**: API 실패 시 자동 재시도
2. **UI 개선**: 로딩 상태, 에러 메시지 개선
3. **성능**: 불필요한 API 호출 제거

### 중기 개선 (1-3개월)
1. **알림 설정**: 사용자별 알림 선호도 설정
2. **요약 커스터마이징**: 요약 스타일, 길이 조절
3. **다국어 지원**: 영어 자막 및 요약
4. **모바일 앱**: React Native 또는 PWA

### 장기 개선 (3개월+)
1. **AI 개선**: 더 정확한 요약, 키워드 추출
2. **확장성**: 마이크로서비스 아키텍처
3. **실시간 알림**: WebSocket 기반 실시간 업데이트
4. **분석 대시보드**: 사용 통계, 트렌드 분석

---

## 📞 연락처 및 지원

### 개발 문의
- 프로젝트 관련 질문은 Slack debug 채널 활용
- 긴급 이슈는 에러 로깅 시스템으로 자동 감지

### 유용한 링크
- [Drizzle ORM 문서](https://orm.drizzle.team/)
- [Slack API 문서](https://api.slack.com/)
- [YouTube Data API 문서](https://developers.google.com/youtube/v3)
- [Anthropic API 문서](https://docs.anthropic.com/)

---

**⚠️ 중요 알림**: 이 시스템은 외부 API에 의존하므로 정기적인 모니터링과 에러 로그 확인이 필수입니다. 특히 API 사용량과 크레딧 잔량을 주기적으로 확인하세요.