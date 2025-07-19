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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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
    <div className="min-h-screen bg-slate-50 flex">
      {/* Left side - Authentication Forms */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Roving Through</h1>
            <p className="text-slate-600">YouTube 영상 요약을 Slack으로 받아보세요</p>
          </div>

          {/* Auth Forms */}
          <Card className="w-full">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
              <CardTitle className="text-center">
                {activeTab === "login" ? "로그인" : "회원가입"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="login">로그인</TabsTrigger>
                  <TabsTrigger value="register">회원가입</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <Form {...loginForm}>
                    <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
                      <FormField
                        control={loginForm.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>아이디</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="아이디를 입력하세요"
                                {...field}
                                disabled={loginMutation.isPending}
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
                            <FormLabel>비밀번호</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder="비밀번호를 입력하세요"
                                {...field}
                                disabled={loginMutation.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700"
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
                            <FormLabel>아이디</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="아이디를 입력하세요"
                                {...field}
                                disabled={registerMutation.isPending}
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
                            <FormLabel>비밀번호</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder="비밀번호를 입력하세요"
                                {...field}
                                disabled={registerMutation.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700"
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
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 to-blue-800 items-center justify-center p-8">
        <div className="text-center text-white space-y-8 max-w-md">
          <div className="space-y-4">
            <div className="flex justify-center space-x-4 mb-6">
              <div className="p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                <Youtube className="w-8 h-8 text-red-400" />
              </div>
              <div className="p-3 bg-white/10 rounded-lg backdrop-blur-sm">
                <div className="w-8 h-8 bg-purple-400 rounded flex items-center justify-center">
                  <div className="w-5 h-5 bg-white rounded-sm"></div>
                </div>
              </div>
            </div>
            
            <h2 className="text-3xl font-bold">
              YouTube를 Slack으로
            </h2>
            <p className="text-blue-100 text-lg">
              좋아하는 채널의 새로운 영상을 놓치지 말고<br />
              자동으로 요약받아보세요
            </p>
          </div>

          <div className="space-y-4 text-left">
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 bg-green-400 rounded-full flex items-center justify-center">
                <div className="w-3 h-3 bg-white rounded-full"></div>
              </div>
              <span>YouTube 채널 자동 모니터링</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 bg-green-400 rounded-full flex items-center justify-center">
                <div className="w-3 h-3 bg-white rounded-full"></div>
              </div>
              <span>AI 기반 영상 내용 요약</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 bg-green-400 rounded-full flex items-center justify-center">
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
