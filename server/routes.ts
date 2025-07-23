import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { slackService } from "./slack";
import ytdl from "@distube/ytdl-core";
import getVideoId from "get-video-id";
import puppeteer from 'puppeteer';

export function registerRoutes(app: Express): Server {
  // sets up /api/register, /api/login, /api/logout, /api/user
  setupAuth(app);

  // YouTube Channel Management Routes
  app.get("/api/channels/:userId", async (req, res) => {
    console.log(`[CHANNELS] Received GET /api/channels/${req.params.userId} request`);
    console.log(`[CHANNELS] Authentication status: ${req.isAuthenticated()}`);
    console.log(`[CHANNELS] User info:`, req.user);
    console.log(`[CHANNELS] Requested userId: ${req.params.userId}`);
    
    if (!req.isAuthenticated()) {
      console.log(`[CHANNELS] Request rejected - user not authenticated`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 요청된 userId가 현재 로그인한 사용자의 ID와 일치하는지 확인
    const requestedUserId = parseInt(req.params.userId, 10);
    if (requestedUserId !== req.user.id) {
      console.log(`[CHANNELS] Access denied - user ${req.user.id} tried to access user ${requestedUserId}'s channels`);
      return res.status(403).json({ error: "Forbidden" });
    }
    
    try {
      console.log(`[CHANNELS] Getting channels for user ${req.user.id}`);
      const channels = await storage.getUserChannels(req.user.id);
      console.log(`[CHANNELS] Found ${channels.length} channels for user ${req.user.id}`);
      res.json(channels);
    } catch (error) {
      console.error("[CHANNELS] Error getting user channels:", error);
      res.status(500).json({ error: "Failed to get channels" });
    }
  });

  app.post("/api/channels", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      console.log(`[CHANNELS] Adding channel request from user ${req.user.id}:`, req.body);
      
      const { handle } = req.body;
      if (!handle || !handle.startsWith('@')) {
        console.log(`[CHANNELS] Invalid handle format: ${handle}`);
        return res.status(400).json({ error: "핸들러는 @로 시작해야 합니다" });
      }

      // 1. 먼저 YouTube 채널 테이블에서 handle로 검색
      console.log(`[CHANNELS] Checking if channel exists in database for handle: ${handle}`);
      let youtubeChannel = await storage.getYoutubeChannelByHandle(handle);
      let channelId: string;

      if (youtubeChannel) {
        // 기존 채널이 있는 경우
        console.log(`[CHANNELS] Found existing channel in database:`, youtubeChannel);
        channelId = youtubeChannel.channelId;
      } else {
        // 새로운 채널인 경우 YouTube API 호출
        const channelHandle = handle.substring(1); // Remove @ from handle for API call
        console.log(`[CHANNELS] Channel not found in database, calling YouTube API for handle: ${channelHandle}`);

        const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${channelHandle}&key=${process.env.YOUTUBE_API_KEY}`;
        console.log(`[CHANNELS] Making YouTube API request to: ${youtubeApiUrl}`);
        
        const response = await fetch(youtubeApiUrl);
        const data = await response.json();
        
        console.log(`[CHANNELS] YouTube API response status: ${response.status}`);
        console.log(`[CHANNELS] YouTube API response:`, JSON.stringify(data, null, 2));

        if (!response.ok) {
          console.error(`[CHANNELS] YouTube API error: ${response.status} - ${data.error?.message || 'Unknown error'}`);
          return res.status(400).json({ error: "YouTube API 요청이 실패했습니다" });
        }

        if (!data.items || data.items.length === 0) {
          console.log(`[CHANNELS] No channel found for handle: ${channelHandle}`);
          return res.status(404).json({ error: "채널 정보가 확인되지 않습니다" });
        }

        const channelData = data.items[0];
        console.log(`[CHANNELS] Found channel data from API:`, {
          id: channelData.id,
          title: channelData.snippet.title,
          subscriberCount: channelData.statistics.subscriberCount,
          videoCount: channelData.statistics.videoCount
        });

        channelId = channelData.id;

        // YouTube 채널 테이블에 새 채널 추가
        youtubeChannel = await storage.createOrUpdateYoutubeChannel({
          channelId: channelData.id,
          handle: handle,
          title: channelData.snippet.title,
          description: channelData.snippet.description || "",
          thumbnail: channelData.snippet.thumbnails?.default?.url || "",
          subscriberCount: channelData.statistics.subscriberCount || "0",
          videoCount: channelData.statistics.videoCount || "0"
        });
        console.log(`[CHANNELS] Created new channel in database:`, youtubeChannel);
      }

      // 2. 사용자가 이미 구독하고 있는지 확인
      const isSubscribed = await storage.isUserSubscribedToChannel(req.user.id, channelId);
      if (isSubscribed) {
        console.log(`[CHANNELS] User ${req.user.id} already subscribed to channel: ${channelId}`);
        return res.status(409).json({ error: "이미 추가된 채널입니다" });
      }

      // 3. user_channels 테이블에 매핑 추가
      const subscription = await storage.subscribeUserToChannel(req.user.id, channelId);
      console.log(`[CHANNELS] Successfully subscribed user ${req.user.id} to channel ${channelId}:`, {
        youtubeChannel,
        subscription
      });
      
      res.status(201).json({
        ...youtubeChannel,
        subscriptionId: subscription.id,
        subscribedAt: subscription.createdAt
      });

    } catch (error) {
      console.error("[CHANNELS] Error adding channel:", error);
      res.status(500).json({ error: "채널 추가 중 오류가 발생했습니다" });
    }
  });

  app.delete("/api/channels/:channelId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const { channelId } = req.params;
      console.log(`[CHANNELS] Unsubscribing user ${req.user.id} from channel ${channelId}`);
      
      await storage.unsubscribeUserFromChannel(req.user.id, channelId);
      console.log(`[CHANNELS] Successfully unsubscribed user ${req.user.id} from channel ${channelId}`);
      
      res.status(200).json({ message: "Channel unsubscribed successfully" });
    } catch (error) {
      console.error("[CHANNELS] Error unsubscribing from channel:", error);
      res.status(500).json({ error: "Failed to unsubscribe from channel" });
    }
  });

  // Slack Manual Setup API endpoint
  app.post("/api/slack/setup", async (req, res) => {
    console.log(`[SLACK_SETUP] Received setup request`);
    
    if (!req.isAuthenticated()) {
      console.log(`[SLACK_SETUP] User not authenticated`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const { email } = req.body;
      console.log(`[SLACK_SETUP] Manual setup request from user ${req.user.id} (${req.user.username}) with email: ${email}`);

      if (!email || !email.includes('@')) {
        console.log(`[SLACK_SETUP] Invalid email format: ${email}`);
        return res.status(400).json({ error: "올바른 이메일 주소를 입력해주세요" });
      }

      // 1. Slack 워크스페이스에서 이메일 확인
      console.log(`[SLACK_SETUP] Verifying email ${email} in Slack workspace...`);
      const emailVerification = await slackService.verifyEmailInWorkspace(email);
      
      if (!emailVerification.exists) {
        console.log(`[SLACK_SETUP] Email ${email} not found in Slack workspace`);
        return res.status(400).json({ 
          error: "입력하신 이메일이 Slack 워크스페이스에 존재하지 않습니다. 먼저 워크스페이스에 가입해주세요." 
        });
      }

      console.log(`[SLACK_SETUP] Email ${email} verified in workspace. Slack User ID: ${emailVerification.userId}`);

      // 2. 사용자 이메일 업데이트
      console.log(`[SLACK_SETUP] Updating user ${req.user.id} email to: ${email}`);
      await storage.updateUserEmail(req.user.id, email);
      console.log(`[SLACK_SETUP] Successfully updated user email`);

      // 3. 사용자 전용 채널 생성
      const channelName = `${req.user.username}-channel`;
      console.log(`[SLACK_SETUP] Creating private channel: ${channelName} for user: ${req.user.username}`);
      
      const channel = await slackService.createPrivateChannel(channelName, req.user.username);
      
      if (!channel) {
        console.error(`[SLACK_SETUP] Failed to create channel for user ${req.user.username}`);
        return res.status(500).json({ error: "채널 생성에 실패했습니다" });
      }

      console.log(`[SLACK_SETUP] Successfully created channel: ${channel.name} (ID: ${channel.id})`);

      // 4. 사용자를 채널에 초대
      console.log(`[SLACK_SETUP] Inviting user ${emailVerification.userId} to channel ${channel.id}`);
      const inviteSuccess = await slackService.inviteUserToChannel(channel.id, emailVerification.userId!);
      
      if (!inviteSuccess) {
        console.error(`[SLACK_SETUP] Failed to invite user to channel`);
        return res.status(500).json({ error: "사용자를 채널에 초대하는데 실패했습니다" });
      }

      console.log(`[SLACK_SETUP] Successfully invited user to channel`);

      // 5. 데이터베이스에 Slack 연동 정보 저장
      console.log(`[SLACK_SETUP] Updating database with Slack info for user ${req.user.id}`);
      await storage.updateUserSlackInfo(req.user.id, {
        slackUserId: emailVerification.userId!,
        slackChannelId: channel.id,
        slackJoinedAt: new Date()
      });
      console.log(`[SLACK_SETUP] Successfully updated database with Slack info`);

      // 6. 관리자 추가
      console.log(`[SLACK_SETUP] Adding admin to channel ${channel.id}`);
      const adminEmail = 'saulpark12@gmail.com';
      const adminVerification = await slackService.verifyEmailInWorkspace(adminEmail);
      
      if (adminVerification.exists) {
        console.log(`[SLACK_SETUP] Admin email ${adminEmail} found, inviting to channel`);
        const adminInviteSuccess = await slackService.inviteUserToChannel(channel.id, adminVerification.userId!);
        if (adminInviteSuccess) {
          console.log(`[SLACK_SETUP] Admin successfully added to channel`);
        } else {
          console.log(`[SLACK_SETUP] Failed to add admin to channel`);
        }
      } else {
        console.log(`[SLACK_SETUP] Admin email ${adminEmail} not found in workspace`);
      }

      // 7. 환영 메시지 전송
      console.log(`[SLACK_SETUP] Sending welcome message to channel ${channel.id}`);
      await slackService.sendWelcomeMessage(channel.id, req.user.username);
      console.log(`[SLACK_SETUP] Welcome message sent`);
      
      console.log(`[SLACK_SETUP] Slack setup completed successfully for user ${req.user.username}`);
      
      res.json({ 
        success: true, 
        message: "Slack 채널이 성공적으로 생성되었습니다.",
        channelId: channel.id,
        channelName: channel.name
      });

    } catch (error) {
      console.error("[SLACK_SETUP] Error in manual setup:", error);
      res.status(500).json({ error: "슬랙 설정 중 오류가 발생했습니다" });
    }
  });

  // Slack Events API endpoint
  app.post("/api/slack/events", async (req, res) => {
    console.log(`[SLACK_EVENTS] Received Slack event`);
    
    try {
      const signature = req.headers['x-slack-signature'] as string;
      const timestamp = req.headers['x-slack-request-timestamp'] as string;
      const body = JSON.stringify(req.body);

      console.log(`[SLACK_EVENTS] Event details:`, {
        type: req.body.type,
        eventType: req.body.event?.type,
        headers: {
          signature: signature ? signature.substring(0, 20) + '...' : 'missing',
          timestamp: timestamp
        }
      });

      // URL verification for initial setup
      if (req.body.type === 'url_verification') {
        console.log(`[SLACK_EVENTS] URL verification challenge received: ${req.body.challenge}`);
        return res.json({ challenge: req.body.challenge });
      }

      // Verify request authenticity
      console.log(`[SLACK_EVENTS] Verifying request signature...`);
      const isValid = await slackService.verifyRequest(body, signature, timestamp);
      if (!isValid) {
        console.log(`[SLACK_EVENTS] Invalid request signature - rejecting request`);
        return res.status(401).json({ error: "Unauthorized" });
      }

      console.log(`[SLACK_EVENTS] Request signature verified successfully`);

      // Handle team_join event
      if (req.body.type === 'event_callback' && req.body.event.type === 'team_join') {
        console.log(`[SLACK_EVENTS] Processing team_join event`);
        console.log(`[SLACK_EVENTS] User profile:`, req.body.event.user.profile);
        
        // team_join 이벤트에서 이메일 정보 추출
        const event = {
          type: 'team_join' as const,
          user: {
            id: req.body.event.user.id,
            email: req.body.event.user.profile.email,
            name: req.body.event.user.profile.display_name || req.body.event.user.profile.real_name
          },
          event_ts: req.body.event.event_ts
        };

        console.log(`[SLACK_EVENTS] Extracted event data:`, event);
        await slackService.handleTeamJoinEvent(event);
        console.log(`[SLACK_EVENTS] Team join event processing completed`);
      } else {
        console.log(`[SLACK_EVENTS] Unhandled event type: ${req.body.type} / ${req.body.event?.type}`);
      }

      console.log(`[SLACK_EVENTS] Sending success response`);
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error("[SLACK_EVENTS] Error processing event:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // YouTube Transcript Extraction Route
  app.post("/api/youtube/transcript", async (req, res) => {
    console.log(`[TRANSCRIPT] Received POST /api/youtube/transcript request`);
    
    if (!req.isAuthenticated()) {
      console.log(`[TRANSCRIPT] Request rejected - user not authenticated`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { url } = req.body;
    console.log(`[TRANSCRIPT] Processing URL: ${url} for user ${req.user.username}`);

    if (!url || typeof url !== "string") {
      console.log(`[TRANSCRIPT] Invalid URL provided: ${url}`);
      return res.status(400).json({ error: "유튜브 URL이 필요합니다." });
    }

    try {
      // Extract video ID from URL
      console.log(`[TRANSCRIPT] Step 1: Extracting video ID from URL: ${url}`);
      const videoData = getVideoId(url);
      console.log(`[TRANSCRIPT] Step 1 Result - Extracted video data:`, JSON.stringify(videoData, null, 2));
      
      if (!videoData || !videoData.id) {
        console.log(`[TRANSCRIPT] Step 1 Error - Invalid YouTube URL: ${url}`);
        return res.status(400).json({ error: "올바른 유튜브 URL을 입력해주세요." });
      }

      const videoId = videoData.id;
      console.log(`[TRANSCRIPT] Step 2: Starting transcript fetch for video ID: ${videoId}`);

      // Try to get video info and extract captions using ytdl-core
      let transcriptData = null;
      let usedLang = null;
      let method = null;

      console.log(`[TRANSCRIPT] Method 1: Getting video info using ytdl-core`);
      
      try {
        const videoInfo = await ytdl.getInfo(videoId);
        console.log(`[TRANSCRIPT] Successfully got video info for: ${videoInfo.videoDetails.title}`);
        console.log(`[TRANSCRIPT] Video length: ${videoInfo.videoDetails.lengthSeconds} seconds`);
        
        const captionTracks = videoInfo.player_response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        
        if (!captionTracks || captionTracks.length === 0) {
          console.log(`[TRANSCRIPT] No caption tracks found in video info`);
          throw new Error("No caption tracks available");
        }
        
        console.log(`[TRANSCRIPT] Found ${captionTracks.length} caption tracks`);
        captionTracks.forEach((track, index) => {
          console.log(`[TRANSCRIPT] Track ${index + 1}: ${track.name?.simpleText} (${track.languageCode})`);
        });
        
        // Try to find Korean captions first, then English, then any available
        let selectedTrack = captionTracks.find(track => track.languageCode === 'ko') ||
                           captionTracks.find(track => track.languageCode === 'en') ||
                           captionTracks[0];
        
        if (!selectedTrack) {
          throw new Error("No suitable caption track found");
        }
        
        console.log(`[TRANSCRIPT] Selected caption track: ${selectedTrack.name?.simpleText} (${selectedTrack.languageCode})`);
        usedLang = selectedTrack.languageCode;
        method = 'ytdl-core';
        
        // Try multiple methods to fetch captions
        let captionXml = '';
        
        // Method 1: Original baseUrl
        try {
          console.log(`[TRANSCRIPT] Method 1A: Fetching from baseUrl: ${selectedTrack.baseUrl.substring(0, 100)}...`);
          const response1 = await fetch(selectedTrack.baseUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          captionXml = await response1.text();
          console.log(`[TRANSCRIPT] Method 1A Response: ${response1.status} - ${captionXml.length} chars`);
        } catch (error) {
          console.log(`[TRANSCRIPT] Method 1A Failed:`, error.message);
        }
        
        // Method 2: Modified baseUrl with format
        if (!captionXml || captionXml.length < 50) {
          try {
            const modifiedUrl = selectedTrack.baseUrl + '&fmt=srv3';
            console.log(`[TRANSCRIPT] Method 1B: Trying with srv3 format: ${modifiedUrl.substring(0, 100)}...`);
            const response2 = await fetch(modifiedUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            captionXml = await response2.text();
            console.log(`[TRANSCRIPT] Method 1B Response: ${response2.status} - ${captionXml.length} chars`);
          } catch (error) {
            console.log(`[TRANSCRIPT] Method 1B Failed:`, error.message);
          }
        }
        
        // Method 3: Direct timedtext API
        if (!captionXml || captionXml.length < 50) {
          try {
            const directUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${selectedTrack.languageCode}&name=${encodeURIComponent(selectedTrack.name?.simpleText || '')}`;
            console.log(`[TRANSCRIPT] Method 1C: Direct API call: ${directUrl}`);
            const response3 = await fetch(directUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            captionXml = await response3.text();
            console.log(`[TRANSCRIPT] Method 1C Response: ${response3.status} - ${captionXml.length} chars`);
          } catch (error) {
            console.log(`[TRANSCRIPT] Method 1C Failed:`, error.message);
          }
        }
        
        console.log(`[TRANSCRIPT] Final caption XML (${captionXml.length} characters)`);
        console.log(`[TRANSCRIPT] Caption XML sample:`, captionXml.substring(0, 500));
        
        if (captionXml && captionXml.length > 50) {
          // Parse XML to extract transcript data
          transcriptData = parseCaptionXml(captionXml);
          console.log(`[TRANSCRIPT] Parsed ${transcriptData.length} caption segments`);
        } else {
          console.log(`[TRANSCRIPT] Caption XML too short or empty, trying fallback methods`);
          throw new Error("Failed to fetch valid caption content");
        }
        
      } catch (ytdlError) {
        console.log(`[TRANSCRIPT] Method 1 (ytdl-core) Failed:`, ytdlError.message);
        
        // Fallback: Try a simple approach with manual URL construction
        console.log(`[TRANSCRIPT] Method 2: Fallback approach - direct caption URL construction`);
        
        try {
          // Try common caption URL patterns
          const captionUrls = [
            `https://www.youtube.com/api/timedtext?v=${videoId}&lang=ko&fmt=srv3`,
            `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=srv3`,
            `https://www.youtube.com/api/timedtext?v=${videoId}&fmt=srv3`,
            `https://www.youtube.com/api/timedtext?v=${videoId}&lang=ko`,
            `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
            `https://www.youtube.com/api/timedtext?v=${videoId}`,
            `https://www.youtube.com/api/timedtext?v=${videoId}&lang=ko&fmt=json3`,
            `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`
          ];
          
          for (const captionUrl of captionUrls) {
            try {
              console.log(`[TRANSCRIPT] Trying caption URL: ${captionUrl}`);
              const response = await fetch(captionUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Accept': 'text/xml,application/xml,application/xhtml+xml,text/html;q=0.9,text/plain;q=0.8,image/png,*/*;q=0.5',
                  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
                  'Referer': `https://www.youtube.com/watch?v=${videoId}`
                }
              });
              
              if (response.ok) {
                const captionText = await response.text();
                console.log(`[TRANSCRIPT] Got response (${captionText.length} chars):`, captionText.substring(0, 200));
                
                if (captionText && captionText.length > 100 && !captionText.includes('error')) {
                  transcriptData = parseCaptionXml(captionText);
                  usedLang = captionUrl.includes('lang=ko') ? 'ko' : captionUrl.includes('lang=en') ? 'en' : 'auto';
                  method = 'direct-url';
                  console.log(`[TRANSCRIPT] Method 2 Success - Parsed ${transcriptData.length} segments`);
                  
                  if (transcriptData && transcriptData.length > 0) {
                    break;
                  }
                }
              }
            } catch (urlError) {
              console.log(`[TRANSCRIPT] URL ${captionUrl} failed:`, urlError.message);
            }
          }
        } catch (fallbackError) {
          console.log(`[TRANSCRIPT] Method 2 (fallback) Failed:`, fallbackError.message);
        }
        
        // Method 3: Try alternative approaches before Puppeteer
        if (!transcriptData || transcriptData.length === 0) {
          console.log(`[TRANSCRIPT] Method 3: Trying YouTube embed approach`);
          try {
            const embedResponse = await fetch(`https://www.youtube.com/embed/${videoId}`, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            
            if (embedResponse.ok) {
              const embedHtml = await embedResponse.text();
              console.log(`[TRANSCRIPT] Got embed HTML (${embedHtml.length} chars)`);
              
              // Look for caption track URLs in embed HTML
              const captionUrlRegex = /"captionTracks":\[([^\]]+)\]/;
              const match = embedHtml.match(captionUrlRegex);
              
              if (match) {
                console.log(`[TRANSCRIPT] Found captionTracks in embed HTML`);
                const captionTracksText = match[1];
                const baseUrlMatch = captionTracksText.match(/"baseUrl":"([^"]+)"/);
                
                if (baseUrlMatch) {
                  const captionUrl = baseUrlMatch[1].replace(/\\u0026/g, '&');
                  console.log(`[TRANSCRIPT] Extracted caption URL: ${captionUrl.substring(0, 100)}...`);
                  
                  const captionResponse = await fetch(captionUrl);
                  const captionXml = await captionResponse.text();
                  
                  if (captionXml && captionXml.length > 50) {
                    transcriptData = parseCaptionXml(captionXml);
                    usedLang = 'embed-extracted';
                    method = 'embed';
                    console.log(`[TRANSCRIPT] Method 3 Success - Parsed ${transcriptData.length} segments from embed`);
                  }
                }
              }
            }
          } catch (embedError) {
            console.log(`[TRANSCRIPT] Method 3 (embed) Failed:`, embedError.message);
          }
        }
        
        // Method 4: Try different API endpoints
        if (!transcriptData || transcriptData.length === 0) {
          console.log(`[TRANSCRIPT] Method 4: Trying alternative API endpoints`);
          try {
            const alternativeUrls = [
              `https://video.google.com/timedtext?v=${videoId}&lang=ko`,
              `https://video.google.com/timedtext?v=${videoId}&lang=en`,
              `https://www.youtube.com/api/timedtext?v=${videoId}&caps=asr&lang=ko&fmt=srv1`,
              `https://www.youtube.com/api/timedtext?v=${videoId}&caps=asr&lang=en&fmt=srv1`,
              `https://www.youtube.com/api/timedtext?v=${videoId}&caps=asr&lang=ko&fmt=vtt`,
              `https://www.youtube.com/api/timedtext?v=${videoId}&caps=asr&lang=en&fmt=vtt`
            ];
            
            for (const altUrl of alternativeUrls) {
              try {
                console.log(`[TRANSCRIPT] Trying alternative URL: ${altUrl}`);
                const response = await fetch(altUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; GoogleBot/2.1)',
                    'Accept': '*/*',
                    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
                  }
                });
                
                if (response.ok) {
                  const content = await response.text();
                  console.log(`[TRANSCRIPT] Alternative URL response (${content.length} chars):`, content.substring(0, 200));
                  
                  if (content && content.length > 50 && !content.includes('error')) {
                    transcriptData = parseCaptionXml(content);
                    usedLang = altUrl.includes('lang=ko') ? 'ko' : 'en';
                    method = 'alternative-api';
                    console.log(`[TRANSCRIPT] Method 4 Success - Parsed ${transcriptData.length} segments`);
                    
                    if (transcriptData && transcriptData.length > 0) {
                      break;
                    }
                  }
                }
              } catch (altError) {
                console.log(`[TRANSCRIPT] Alternative URL ${altUrl} failed:`, altError.message);
              }
            }
          } catch (methodError) {
            console.log(`[TRANSCRIPT] Method 4 Failed:`, methodError.message);
          }
        }
        
        // Method 5: Try to extract from player response data more thoroughly
        if (!transcriptData || transcriptData.length === 0) {
          console.log(`[TRANSCRIPT] Method 5: Deep parsing of ytdl player response`);
          try {
            const videoInfo = await ytdl.getInfo(videoId);
            const playerResponse = videoInfo.player_response;
            
            // Look more thoroughly in the player response
            if (playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
              const tracks = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
              
              for (const track of tracks) {
                console.log(`[TRANSCRIPT] Deep parsing track: ${track.name?.simpleText} (${track.languageCode})`);
                
                if (track.baseUrl) {
                  // Try multiple variations of the base URL
                  const urlVariations = [
                    track.baseUrl,
                    track.baseUrl.replace('&fmt=srv3', ''),
                    track.baseUrl + '&fmt=srv1',
                    track.baseUrl + '&fmt=vtt',
                    track.baseUrl + '&fmt=ttml',
                    track.baseUrl.replace(/&tlang=[^&]*/, ''), // Remove translation language
                    track.baseUrl.replace(/&caps=[^&]*/, '&caps=asr'), // Force ASR captions
                  ];
                  
                  for (const variation of urlVariations) {
                    try {
                      console.log(`[TRANSCRIPT] Trying URL variation: ${variation.substring(0, 100)}...`);
                      
                      const response = await fetch(variation, {
                        headers: {
                          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                          'Accept': 'text/xml,application/xml,text/vtt,text/plain,*/*',
                          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
                          'Cache-Control': 'no-cache',
                          'Pragma': 'no-cache'
                        }
                      });
                      
                      if (response.ok) {
                        const content = await response.text();
                        console.log(`[TRANSCRIPT] URL variation response: ${response.status} - ${content.length} chars`);
                        console.log(`[TRANSCRIPT] Content sample:`, content.substring(0, 300));
                        
                        if (content && content.length > 50 && !content.toLowerCase().includes('not found')) {
                          const parsed = parseCaptionXml(content);
                          if (parsed && parsed.length > 0) {
                            transcriptData = parsed;
                            usedLang = track.languageCode;
                            method = 'deep-ytdl';
                            console.log(`[TRANSCRIPT] Method 5 Success - Found ${transcriptData.length} segments`);
                            break;
                          }
                        }
                      }
                    } catch (varError) {
                      console.log(`[TRANSCRIPT] URL variation failed: ${varError.message}`);
                    }
                  }
                  
                  if (transcriptData && transcriptData.length > 0) {
                    break;
                  }
                }
              }
            }
          } catch (deepError) {
            console.log(`[TRANSCRIPT] Method 5 Failed:`, deepError.message);
          }
        }
      }

      if (!transcriptData || transcriptData.length === 0) {
        console.log(`[TRANSCRIPT] Step 2 Final Error - No transcript data found after trying all methods`);
        return res.status(404).json({ 
          error: "이 영상에는 자막이 없거나 비공개 설정되어 있습니다.",
          details: `Tried methods: auto-detect, multiple languages (ko, en, es, fr, de, ja, zh), multiple countries (US, KR, GB, CA)`
        });
      }

      console.log(`[TRANSCRIPT] Step 3: Processing ${transcriptData.length} transcript segments`);
      console.log(`[TRANSCRIPT] Full raw transcript data:`, JSON.stringify(transcriptData, null, 2));

      // Format transcript data
      const segments = transcriptData.map((item, index) => {
        console.log(`[TRANSCRIPT] Processing segment ${index + 1}:`, JSON.stringify(item, null, 2));
        return {
          text: item.text,
          timestamp: item.offset,
          duration: item.duration,
          formattedTime: formatTimestamp(item.offset)
        };
      });

      const fullText = transcriptData.map(item => item.text).join(' ');
      const totalDuration = transcriptData[transcriptData.length - 1]?.offset || 0;

      const formattedTranscript = {
        videoId,
        videoUrl: url,
        segments,
        fullText,
        totalDuration,
        language: usedLang,
        method: method,
        segmentCount: transcriptData.length,
        extractedAt: new Date().toISOString()
      };

      console.log(`[TRANSCRIPT] Step 4: Final formatted transcript:`, JSON.stringify({
        videoId: formattedTranscript.videoId,
        segmentCount: formattedTranscript.segmentCount,
        language: formattedTranscript.language,
        fullTextLength: formattedTranscript.fullText.length,
        totalDuration: formattedTranscript.totalDuration,
        firstSegment: formattedTranscript.segments[0],
        lastSegment: formattedTranscript.segments[formattedTranscript.segments.length - 1]
      }, null, 2));

      console.log(`[TRANSCRIPT] Step 5: Sending response to client`);
      res.json(formattedTranscript);

    } catch (error) {
      console.error("[TRANSCRIPT] Step ERROR - Error extracting transcript:", error);
      console.error("[TRANSCRIPT] Error details:", {
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
        code: error?.code
      });
      
      // Handle specific errors
      if (error.message?.includes('Could not retrieve a transcript')) {
        console.log("[TRANSCRIPT] Error Type: No transcript available");
        return res.status(404).json({ 
          error: "이 영상에는 자막이 없거나 비공개 설정되어 있습니다.",
          errorType: "NO_TRANSCRIPT",
          details: error.message
        });
      }
      
      if (error.message?.includes('Too Many Requests')) {
        console.log("[TRANSCRIPT] Error Type: Rate limited");
        return res.status(429).json({ 
          error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
          errorType: "RATE_LIMIT"
        });
      }

      if (error.message?.includes('Video unavailable')) {
        console.log("[TRANSCRIPT] Error Type: Video unavailable");
        return res.status(404).json({ 
          error: "영상을 찾을 수 없거나 비공개 상태입니다.",
          errorType: "VIDEO_UNAVAILABLE"
        });
      }

      console.log("[TRANSCRIPT] Error Type: Unknown error");
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "자막 추출에 실패했습니다.",
        errorType: "UNKNOWN",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}

// Helper function to format timestamp
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Helper function to parse caption XML
function parseCaptionXml(xmlContent: string): Array<{text: string, offset: number, duration: number}> {
  try {
    const segments: Array<{text: string, offset: number, duration: number}> = [];
    
    // Method 1: Try standard XML format first
    const textRegex = /<text start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([^<]*)</g;
    let match;
    
    while ((match = textRegex.exec(xmlContent)) !== null) {
      const startTime = parseFloat(match[1]) || 0;
      const duration = parseFloat(match[2]) || 3;
      const text = match[3]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      
      if (text && text.length > 0) {
        segments.push({
          text: text,
          offset: startTime,
          duration: duration
        });
      }
    }
    
    // Method 2: If no segments found, try alternative formats
    if (segments.length === 0) {
      console.log('[TRANSCRIPT] Trying alternative XML parsing methods');
      
      // Try with different XML structures
      const altRegex1 = /<p t="([^"]*)"(?:\s+d="([^"]*)")?[^>]*>([^<]*)</g;
      while ((match = altRegex1.exec(xmlContent)) !== null) {
        const startTime = parseFloat(match[1]) / 1000 || 0; // Convert milliseconds to seconds
        const duration = parseFloat(match[2]) / 1000 || 3;
        const text = match[3]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();
        
        if (text && text.length > 0) {
          segments.push({
            text: text,
            offset: startTime,
            duration: duration
          });
        }
      }
    }
    
    // Method 3: Try JSON format (sometimes returned instead of XML)
    if (segments.length === 0 && xmlContent.includes('{')) {
      console.log('[TRANSCRIPT] Trying JSON parsing');
      try {
        const jsonData = JSON.parse(xmlContent);
        if (jsonData.events) {
          jsonData.events.forEach((event: any) => {
            if (event.segs) {
              event.segs.forEach((seg: any) => {
                if (seg.utf8) {
                  segments.push({
                    text: seg.utf8.trim(),
                    offset: (event.tStartMs || 0) / 1000,
                    duration: (event.dDurationMs || 3000) / 1000
                  });
                }
              });
            }
          });
        }
      } catch (jsonError) {
        console.log('[TRANSCRIPT] JSON parsing failed:', jsonError.message);
      }
    }
    
    // Method 4: Try VTT format
    if (segments.length === 0 && xmlContent.includes('WEBVTT')) {
      console.log('[TRANSCRIPT] Trying VTT parsing');
      const vttLines = xmlContent.split('\n');
      let currentTime = 0;
      
      for (let i = 0; i < vttLines.length; i++) {
        const line = vttLines[i].trim();
        if (line.includes('-->')) {
          const timeMatch = line.match(/(\d+:\d+:\d+\.?\d*) --> (\d+:\d+:\d+\.?\d*)/);
          if (timeMatch) {
            const startTime = parseTimeToSeconds(timeMatch[1]);
            const endTime = parseTimeToSeconds(timeMatch[2]);
            const duration = endTime - startTime;
            
            // Get the text from the next non-empty line
            for (let j = i + 1; j < vttLines.length; j++) {
              const textLine = vttLines[j].trim();
              if (textLine && !textLine.includes('-->')) {
                segments.push({
                  text: textLine,
                  offset: startTime,
                  duration: duration
                });
                break;
              } else if (textLine === '') {
                break;
              }
            }
          }
        }
      }
    }
    
    console.log(`[TRANSCRIPT] Parsed ${segments.length} segments using XML parser`);
    return segments;
  } catch (error) {
    console.error('[TRANSCRIPT] Error parsing caption content:', error);
    return [];
  }
}

// Helper function to convert time string to seconds
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0]) || 0;
  const minutes = parseInt(parts[1]) || 0;
  const seconds = parseFloat(parts[2]) || 0;
  return hours * 3600 + minutes * 60 + seconds;
}

// Puppeteer-based transcript extraction as last resort
async function extractTranscriptWithPuppeteer(videoId: string): Promise<Array<{text: string, offset: number, duration: number}>> {
  let browser;
  try {
    console.log(`[TRANSCRIPT] Starting Puppeteer for video: ${videoId}`);
    
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Navigate to YouTube video
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`[TRANSCRIPT] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    
    // Wait for video to load
    await page.waitForSelector('video', { timeout: 15000 });
    
    // Try to find and click the CC button
    try {
      await page.waitForSelector('.ytp-subtitles-button', { timeout: 5000 });
      await page.click('.ytp-subtitles-button');
      console.log(`[TRANSCRIPT] Clicked CC button`);
      await page.waitForTimeout(2000);
    } catch (ccError) {
      console.log(`[TRANSCRIPT] Could not find or click CC button:`, ccError.message);
    }
    
    // Look for caption/transcript data in the page
    const transcriptData = await page.evaluate(() => {
      // Try to find any caption elements or transcript data
      const captionElements = document.querySelectorAll('.caption-window, .ytp-caption-segment, .captions-text');
      if (captionElements.length > 0) {
        console.log('Found caption elements:', captionElements.length);
        return Array.from(captionElements).map((el, index) => ({
          text: el.textContent?.trim() || '',
          offset: index * 3,
          duration: 3
        })).filter(item => item.text.length > 0);
      }
      
      // Try to find transcript in player response
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.includes('captionTracks') || content.includes('timedtext')) {
          console.log('Found potential caption data in script');
          // Try to extract caption URLs from the script
          const captionMatches = content.match(/"baseUrl":"([^"]*timedtext[^"]*)"/g);
          if (captionMatches) {
            console.log('Found caption URLs:', captionMatches.length);
            return [{ text: 'Found caption URLs via Puppeteer', offset: 0, duration: 1 }];
          }
        }
      }
      
      return [];
    });
    
    if (transcriptData && transcriptData.length > 0) {
      console.log(`[TRANSCRIPT] Puppeteer extracted ${transcriptData.length} segments`);
      return transcriptData;
    }
    
    // If no direct captions found, try to extract script data for manual processing
    const pageContent = await page.content();
    const captionUrlMatch = pageContent.match(/"baseUrl":"([^"]*timedtext[^"]*)"/);
    
    if (captionUrlMatch) {
      const captionUrl = captionUrlMatch[1].replace(/\\u0026/g, '&');
      console.log(`[TRANSCRIPT] Found caption URL via Puppeteer: ${captionUrl.substring(0, 100)}...`);
      
      // Fetch the caption content
      try {
        const response = await fetch(captionUrl);
        const captionXml = await response.text();
        console.log(`[TRANSCRIPT] Fetched caption XML via Puppeteer (${captionXml.length} chars)`);
        
        if (captionXml && captionXml.length > 50) {
          return parseCaptionXml(captionXml);
        }
      } catch (fetchError) {
        console.log(`[TRANSCRIPT] Failed to fetch caption URL found by Puppeteer:`, fetchError.message);
      }
    }
    
    return [];
    
  } catch (error) {
    console.error(`[TRANSCRIPT] Puppeteer error:`, error);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
