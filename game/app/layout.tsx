import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "工间大富翁 · 安静玩一会儿",
  description: "44 格街区棋盘，26 种事件、10 种互动道具与多骰交通工具。单人对电脑或最多 4 人联机，15 分钟一局。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
