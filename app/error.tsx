"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-page"><div className="error-card"><span>!</span><h1>ระบบสะดุดชั่วคราว</h1><p>ข้อมูลยังอยู่ ลองเปิดหน้านี้ใหม่อีกครั้ง</p><button className="button button-primary" onClick={reset}>ลองอีกครั้ง</button></div></main>;
}
