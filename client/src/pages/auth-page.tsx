import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema, type InsertUser } from "@shared/schema";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Redirect } from "wouter";
import { Loader2, Youtube, Slack } from "lucide-react";
import slackIcon from "@assets/icons8-새로운-slack-48_1753583884909.png";

const loginSchema = insertUserSchema;
const registerSchema = insertUserSchema;

type LoginData = z.infer<typeof loginSchema>;
type RegisterData = z.infer<typeof registerSchema>;

export default function AuthPage() {
  const { user, loginMutation, registerMutation, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("login");

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const registerForm = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  // Redirect if already logged in
  if (user) {
    return <Redirect to="/" />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-[#8B5CF6]" />
      </div>
    );
  }

  const onLoginSubmit = (data: LoginData) => {
    loginMutation.mutate(data);
  };

  const onRegisterSubmit = (data: RegisterData) => {
    registerMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex">
      {/* Left side - Authentication Forms */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Youtube className="h-8 w-8 text-red-600" />
              <img src={slackIcon} alt="Slack" className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">SHOOK</h1>
            <p className="text-gray-600 dark:text-gray-400">YouTube 영상 요약을 Slack으로 받아보세요</p>
          </div>

          {/* Auth Forms */}
          <Card className="w-full border-gray-200 dark:border-gray-700 shadow-lg">
            <CardHeader className="bg-[#8B5CF6] text-white rounded-t-lg">
              <CardTitle className="text-center">
                {activeTab === "login" ? "로그인" : "회원가입"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 bg-white dark:bg-gray-800">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6 bg-gray-100 dark:bg-gray-700">
                  <TabsTrigger value="login" className="data-[state=active]:bg-[#8B5CF6] data-[state=active]:text-white">로그인</TabsTrigger>
                  <TabsTrigger value="register" className="data-[state=active]:bg-[#8B5CF6] data-[state=active]:text-white">회원가입</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <Form {...loginForm}>
                    <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
                      <FormField
                        control={loginForm.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-gray-700 dark:text-gray-300">아이디</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="아이디를 입력하세요"
                                {...field}
                                disabled={loginMutation.isPending}
                                className="border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={loginForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-gray-700 dark:text-gray-300">비밀번호</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder="비밀번호를 입력하세요"
                                {...field}
                                disabled={loginMutation.isPending}
                                className="border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="submit"
                        className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                        disabled={loginMutation.isPending}
                      >
                        {loginMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        로그인
                      </Button>
                    </form>
                  </Form>
                </TabsContent>

                <TabsContent value="register">
                  <Form {...registerForm}>
                    <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-4">
                      <FormField
                        control={registerForm.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-gray-700 dark:text-gray-300">아이디</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="아이디를 입력하세요"
                                {...field}
                                disabled={registerMutation.isPending}
                                className="border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-gray-700 dark:text-gray-300">비밀번호</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder="비밀번호를 입력하세요"
                                {...field}
                                disabled={registerMutation.isPending}
                                className="border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="submit"
                        className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                        disabled={registerMutation.isPending}
                      >
                        {registerMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        회원가입
                      </Button>
                    </form>
                  </Form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right side - Hero Section */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#8B5CF6] items-center justify-center p-8">
        <div className="text-center text-white space-y-8 max-w-md">
          <div className="space-y-4">
            <div className="flex justify-center space-x-4 mb-6">
              <div className="p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                <Youtube className="w-8 h-8 text-red-400" />
              </div>
              <div className="p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                <img src={slackIcon} alt="Slack" className="w-8 h-8" />
              </div>
            </div>
            
            <h2 className="text-3xl font-bold">
              YouTube를 Slack으로
            </h2>
            <p className="text-white/80 text-lg">
              좋아하는 채널의 새로운 영상을 놓치지 말고<br />
              자동으로 요약받아보세요
            </p>
          </div>

          <div className="space-y-4 text-left">
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center">
                <div className="w-3 h-3 bg-white rounded-full"></div>
              </div>
              <span>YouTube 채널 자동 모니터링</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center">
                <div className="w-3 h-3 bg-white rounded-full"></div>
              </div>
              <span>AI 기반 영상 내용 요약</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center">
                <div className="w-3 h-3 bg-white rounded-full"></div>
              </div>
              <span>Slack으로 실시간 알림</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
