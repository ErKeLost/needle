import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";

type Props = {
  service: "netease" | "qq" | "qishui";
  onClose: () => void;
  onDone: (cookie: string, name?: string) => void;
};

const NAME = { netease: "网易云音乐", qq: "QQ 音乐", qishui: "汽水音乐" } as const;

/** Scan with the phone app; the window closes when the service says so. */
export function LoginPanel({ service, onClose, onDone }: Props) {
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState("正在取二维码…");
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    let gap = service === "qishui" ? 4500 : 1500;
    let key = "";

    const poll = async () => {
      if (!alive || finished.current) return;
      try {
        if (service === "netease") {
          const answer = await invoke<{ code: number; cookie: string; message?: string }>(
            "netease_qr_poll",
            { key },
          );
          if (answer.code === 803) {
            if (!answer.cookie) {
              setError("登录成功但没拿到 MUSIC_U，看看日志");
              return;
            }
            finished.current = true;
            setStatus("登录成功");
            onDone(answer.cookie);
            return;
          }
          if (answer.code === 8821) {
            setError("网易云判定当前网络环境有风险，改用网页登录");
            return;
          }
          if (answer.code === 802) setStatus("已扫码，请在手机上确认");
          if (answer.code === 800) setStatus("二维码过期，重新打开一次");
          if (answer.code === 801) setStatus("等待扫码…");
        } else if (service === "qishui") {
          const answer = await invoke<{
            status: string;
            cookie?: string;
            redirect?: string;
            error?: string;
            errorCode?: number;
          }>("qishui_qr_poll");
          if (answer.errorCode === 7) {
            setStatus("登录服务限流，放慢轮询…");
            gap = Math.min(gap * 2, 30000);
            timer = window.setTimeout(poll, gap);
            return;
          }
          if (answer.status === "confirmed" && answer.cookie) {
            finished.current = true;
            setStatus("登录成功");
            onDone(answer.cookie);
            return;
          }
          if (answer.status === "scanned" || answer.status === "2")
            setStatus("已扫码，请在手机上确认");
          if (answer.status === "expired") setStatus("二维码过期，重新打开一次");
          if (answer.status === "new" || answer.status === "1") setStatus("等待扫码…");
          if (answer.status && !["1", "2", "new", "scanned"].includes(answer.status)) {
            setStatus(`等待确认（${answer.status}）`);
          }
        } else {
          const answer = await invoke<{ code: string; url: string }>("qq_qr_poll");
          if (answer.code === "0" && answer.url) {
            setStatus("已确认，正在换取登录态…");
            const session = await invoke<{ cookie: string; name?: string }>("qq_qr_exchange", {
              url: answer.url,
            });
            finished.current = true;
            onDone(session.cookie, session.name);
            return;
          }
          if (answer.code === "66") setStatus("已扫码，请在手机上确认");
          if (answer.code === "67") setStatus("已取消，重新打开一次");
          if (answer.code === "65") setStatus("等待扫码…");
        }
      } catch (problem) {
        if (alive) setError(typeof problem === "string" ? problem : "登录失败");
      }
      // The passport allows only a couple of checks per window; the official
      // client waits 3.5s and we start at 4.5s, growing on a refusal.
      timer = window.setTimeout(poll, gap);
    };

    (async () => {
      try {
        if (service === "netease") {
          const created = await invoke<{ key: string; url: string }>("netease_qr_create");
          key = created.key;
          const data = await QRCode.toDataURL(created.url, {
            margin: 1,
            width: 232,
            color: { dark: "#0b090b", light: "#f3ece3" },
          });
          if (alive) setImage(data);
        } else if (service === "qishui") {
          const created = await invoke<{ qrcode: string }>("qishui_qr_create");
          const data = await QRCode.toDataURL(created.qrcode, {
            margin: 1,
            width: 232,
            color: { dark: "#0b090b", light: "#f3ece3" },
          });
          if (alive) setImage(data);
        } else {
          const created = await invoke<{ png: number[] }>("qq_qr_create");
          const blob = new Blob([new Uint8Array(created.png)], { type: "image/png" });
          if (alive) setImage(URL.createObjectURL(blob));
        }
        if (alive) setStatus("等待扫码…");
        timer = window.setTimeout(poll, gap);
      } catch (problem) {
        if (alive) setError(typeof problem === "string" ? problem : "取二维码失败");
      }
    })();

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [service, onDone]);

  return (
    <div className="login" role="dialog" aria-modal="true" aria-label={`登录${NAME[service]}`}>
      <button type="button" className="login__scrim" aria-label="关闭" onClick={onClose} />
      <div className="login__panel">
        <div className="login__head">
          <span className="login__title">登录{NAME[service]}</span>
          <button type="button" className="login__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="login__code">
          {image ? <img src={image} alt="" /> : <span className="login__placeholder" />}
        </div>

        <p className={`login__status${error ? " is-error" : ""}`}>{error ?? status}</p>
        <p className="login__hint">
          打开手机{NAME[service]} App，扫上面的码
        </p>

        <button
          type="button"
          className="login__fallback"
          onClick={async () => {
            setError(null);
            setStatus("请在打开的窗口里完成登录…");
            try {
              const cookie = await invoke<string>("open_login", { serviceName: service });
              if (cookie) onDone(cookie);
            } catch (problem) {
              setError(typeof problem === "string" ? problem : "网页登录没有完成");
            }
          }}
        >
          改用网页登录
        </button>
      </div>
    </div>
  );
}
