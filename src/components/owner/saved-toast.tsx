"use client";

import { useEffect, useState } from "react";
import { Toast } from "@/components/owner/toast";

/** Toast setelah redirect dari form. Parameter URL dibuang agar toast tidak muncul lagi saat halaman dimuat ulang. */
export function SavedToast({ message }: { message: string }) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  if (!isVisible) return null;
  return <Toast message={message} onDismiss={() => setIsVisible(false)} />;
}
