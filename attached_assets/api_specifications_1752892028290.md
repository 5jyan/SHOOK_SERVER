# 서비스 API 호출 목록 및 스펙 (API Calls List & Specifications)

본 문서는 YouTube 채널 영상 요약 및 Slack 알림 서비스 구현에 필요한 주요 API 호출 목록과 그 스펙을 정의합니다.

## 1. Google YouTube Data API v3

### 1.1. 채널 정보 조회 (channels.list)
- **목적**: YouTube 채널 핸들러를 통해 채널의 고유 ID, 섬네일, 채널명, 구독자 수 조회
- **엔드포인트**: `GET https://www.googleapis.com/youtube/v3/channels`
- **파라미터**:
  - `part`: `snippet,statistics` (필수)
  - `forHandle`: `@GoogleDevelopers` 등 핸들러명
  - `key`: Google API Key (필수)
- **인증**: API Key
- **응답 예시 필드**:
  - `items[0].id` → 채널 ID
  - `items[0].snippet.title` → 채널명
  - `items[0].snippet.thumbnails.default.url` → 섬네일
  - `items[0].statistics.subscriberCount` → 구독자 수
- **필요 스코프**: `https://www.googleapis.com/auth/youtube.readonly`

### 1.2. 영상 자막 목록 조회 (captions.list)
- **목적**: 자동 생성 자막 식별
- **엔드포인트**: `GET https://www.googleapis.com/youtube/v3/captions`
- **파라미터**:
  - `part`: `snippet` (필수)
  - `videoId`: 영상 ID (필수)
- **인증**: OAuth 2.0
- **응답 예시 필드**: `snippet.trackKind = "ASR"`

### 1.3. 영상 자막 다운로드 (captions.download)
- **목적**: 자막 텍스트 다운로드
- **엔드포인트**: `GET https://www.googleapis.com/youtube/v3/captions/{captionId}`
- **파라미터**:
  - `id`: 자막 ID (필수)
  - `tfmt`: `srt` 또는 `sbv`
  - `tlang`: 번역 언어 코드 (예: `ko`)
- **인증**: OAuth 2.0

## 2. Slack API

### 2.1. Slack 사용자 ID 조회 (users.lookupByEmail)
- **목적**: 이메일로 Slack 사용자 ID 조회
- **엔드포인트**: `GET https://slack.com/api/users.lookupByEmail`
- **파라미터**: `email`
- **인증**: Bot Token (`xoxb-`)
- **필요 스코프**: `users:read.email`

### 2.2. 워크스페이스 합류 감지 (Events API - team_join)
- **목적**: 사용자의 워크스페이스 합류 감지
- **메커니즘**: `Slack Events API` 사용 (`team_join` 이벤트 구독)
- **페이로드**: `user.id` 포함 JSON 데이터
- **필요 스코프**: `users:read`

### 2.3. 비공개 Slack 채널 생성 (conversations.create)
- **목적**: 사용자 전용 비공개 채널 생성
- **엔드포인트**: `POST https://slack.com/api/conversations.create`
- **파라미터**:
  - `name`: 채널 이름 (예: `youtube-summary-userid`)
  - `is_private`: `true`
  - `members`: 초대할 멤버 목록 (선택)
- **필요 스코프**: `channels:manage`, `groups:write`

### 2.4. 사용자 및 봇 채널 초대 (conversations.invite)
- **목적**: 채널에 사용자/봇 초대
- **엔드포인트**: `POST https://slack.com/api/conversations.invite`
- **파라미터**:
  - `channel`: 채널 ID
  - `users`: 사용자 ID 목록 (쉼표 구분)
- **필요 스코프**: `channels:join`, `channels:read`, `channels:write`

### 2.5. Slack 메시지 게시 (chat.postMessage)
- **목적**: 요약된 영상 내용을 Slack에 전송
- **엔드포인트**: `POST https://slack.com/api/chat.postMessage`
- **파라미터**:
  - `channel`: 채널 ID
  - `text`: 메시지 내용
  - `blocks`, `username`, `icon_emoji`: 선택
- **필요 스코프**: `chat:write`

### 2.6. 채널 멤버십 확인 (conversations.members)
- **목적**: 특정 사용자가 채널 멤버인지 확인
- **엔드포인트**: `GET https://slack.com/api/conversations.members`
- **파라미터**: `channel`
- **필요 스코프**: `channels:read`, `groups:read`

## 3. Claude API (예시)

- **목적**: 영상 자막 요약 (한국어)
- **엔드포인트**: `POST https://api.anthropic.com/v1/messages`
- **파라미터**:
  - `model`: 예) `claude-3-sonnet-20240229`
  - `messages`: `[{"role": "user", "content": "다음 텍스트를 한국어로 요약해 줘: [자막 텍스트]"}]`
  - `max_tokens`, `temperature`: 선택
- **인증**: API Key (HTTP Header)
- **응답**: 요약된 텍스트 포함 JSON 객체