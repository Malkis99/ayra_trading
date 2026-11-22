/** Quotes execute in their own browsing context: never clear a still-loading script's parent DOM. */
const jsonForScript = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

export function quotesFrameDocument(scriptUrl: string, config: unknown, token: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:transparent}*{box-sizing:border-box}.tradingview-widget-container{width:100%;height:100%}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget" style="height:100%"></div></div><script>
const host=document.querySelector('.tradingview-widget-container');
const tell=status=>parent.postMessage({type:'ayra-quotes-frame',token:${jsonForScript(token)},status},'*');
const observer=new MutationObserver(()=>{if(host.querySelector('iframe')){observer.disconnect();tell('ready');}});
observer.observe(host,{childList:true,subtree:true});
const script=document.createElement('script');script.async=true;script.src=${jsonForScript(scriptUrl)};
script.textContent=${jsonForScript(JSON.stringify(config))};
script.onerror=()=>{observer.disconnect();tell('error');};host.append(script);
</script></body></html>`;
}

let nextToken = 0;

export function mountQuotesFrame(host: HTMLElement, scriptUrl: string, config: unknown, label: string, timeoutMs: number, finish: (status: "ready" | "error") => void) {
  const token = String(++nextToken), frame = document.createElement("iframe");
  frame.title = label;
  frame.dataset.tradingviewQuotesFrame = "";
  frame.style.cssText = "width:100%;height:100%;border:0;display:block;background:transparent";
  // A lifecycle boundary, not a security sandbox: the official embed requires origin/cookie access.
  // Its trust is unchanged from the old script running directly in AYRA's document.
  frame.srcdoc = quotesFrameDocument(scriptUrl, config, token);
  let settled = false;
  const stop = () => { window.clearTimeout(timer); window.removeEventListener("message", onMessage); };
  const settle = (status: "ready" | "error") => {
    if (settled) return;
    settled = true;
    stop();
    if (status === "error") frame.remove();
    finish(status);
  };
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.data?.type !== "ayra-quotes-frame" || event.data.token !== token) return;
    if (event.data.status === "ready" || event.data.status === "error") settle(event.data.status);
  };
  const timer = window.setTimeout(() => settle("error"), timeoutMs);
  window.addEventListener("message", onMessage);
  host.append(frame);
  return {
    /** A ready frame stays visible; its startup listener and deadline are already gone. */
    release: stop,
    dispose: () => { settled = true; stop(); frame.remove(); },
  };
}
