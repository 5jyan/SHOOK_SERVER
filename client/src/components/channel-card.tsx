import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Youtube, Users, Video, Trash2, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import type { YoutubeChannel } from "@shared/schema";

interface ChannelCardProps {
  channel: YoutubeChannel & { subscriptionId: number; subscribedAt: Date | null };
  onDelete: (channelId: string) => void;
  isDeleting?: boolean;
}

export function ChannelCard({ channel, onDelete, isDeleting = false }: ChannelCardProps) {
  const formatSubscriberCount = (count: string | number) => {
    const num = typeof count === 'string' ? parseInt(count) : count;
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "날짜 없음";
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('ko-KR');
  };

  return (
    <Card className="h-full border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <img
              src={channel.thumbnail}
              alt={`${channel.title} thumbnail`}
              className="w-12 h-12 rounded-full object-cover border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-800"
            />
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base font-medium text-gray-900 dark:text-gray-100 line-clamp-2 mb-1">
                {channel.title}
              </CardTitle>
              <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                {channel.handle}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(channel.channelId)}
            disabled={isDeleting}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/20 flex-shrink-0"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-2 mb-3">
          <Badge variant="secondary" className="text-xs">
            <Users className="h-3 w-3 mr-1" />
            {formatSubscriberCount(channel.subscriberCount)}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            <Video className="h-3 w-3 mr-1" />
            {channel.videoCount}개
          </Badge>
        </div>
        
        {channel.recentVideoTitle && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Youtube className="h-4 w-4 text-red-600" />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">최신 영상</span>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 mb-2">
              {channel.recentVideoTitle}
            </p>
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(channel.videoPublishedAt)}
              </div>
              <div className="flex items-center gap-1">
                {channel.processed ? (
                  <>
                    <CheckCircle className="h-3 w-3 text-green-600" />
                    <span>요약 완료</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3 text-yellow-600" />
                    <span>처리 중</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        
        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <span>구독일:</span>
          <span>{formatDate(channel.subscribedAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}