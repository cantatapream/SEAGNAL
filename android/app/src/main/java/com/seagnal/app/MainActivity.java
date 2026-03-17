package com.seagnal.app;

import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.content.Context;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private boolean isShowingError = false;

    @Override
    public void onStart() {
        super.onStart();
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            // 시스템 폰트 크기 설정을 무시하고 100%로 고정
            WebSettings settings = webView.getSettings();
            settings.setTextZoom(100);

            // 커스텀 WebViewClient로 네트워크 에러 감지
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    // 메인 프레임 로딩 에러만 처리 (이미지, CSS 등 서브리소스 에러는 무시)
                    if (request.isForMainFrame()) {
                        isShowingError = true;
                        view.loadDataWithBaseURL(null, getOfflineErrorHtml(), "text/html", "UTF-8", null);
                    }
                }

                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    // 에러 페이지의 자체 로딩은 무시
                    if (url == null || url.equals("about:blank")) return;
                    isShowingError = false;
                    super.onPageStarted(view, url, favicon);
                }
            });
        }
    }

    /**
     * 네트워크 연결 상태 확인
     */
    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
            return activeNetwork != null && activeNetwork.isConnected();
        }
        return false;
    }

    /**
     * 오프라인 에러 페이지 HTML
     * 앱의 다크 테마(#080a0f ~ #1c2640)에 맞춘 디자인
     */
    private String getOfflineErrorHtml() {
        return "<!DOCTYPE html>" +
            "<html lang='ko'>" +
            "<head>" +
            "<meta charset='UTF-8'>" +
            "<meta name='viewport' content='width=device-width, initial-scale=1.0'>" +
            "<style>" +
            "* { margin: 0; padding: 0; box-sizing: border-box; }" +
            "body {" +
            "  font-family: 'Inter', 'Noto Sans KR', sans-serif;" +
            "  background: linear-gradient(180deg, #080a0f 0%, #111525 50%, #080a0f 100%);" +
            "  color: #ffffff;" +
            "  display: flex;" +
            "  align-items: center;" +
            "  justify-content: center;" +
            "  min-height: 100vh;" +
            "  text-align: center;" +
            "  padding: 24px;" +
            "}" +
            ".error-container {" +
            "  max-width: 340px;" +
            "}" +
            ".error-icon {" +
            "  width: 80px;" +
            "  height: 80px;" +
            "  margin: 0 auto 28px;" +
            "  border-radius: 50%;" +
            "  background: rgba(255, 82, 82, 0.12);" +
            "  display: flex;" +
            "  align-items: center;" +
            "  justify-content: center;" +
            "}" +
            ".error-icon svg {" +
            "  width: 40px;" +
            "  height: 40px;" +
            "  stroke: #ff5252;" +
            "  fill: none;" +
            "  stroke-width: 2;" +
            "  stroke-linecap: round;" +
            "  stroke-linejoin: round;" +
            "}" +
            ".error-title {" +
            "  font-size: 1.3rem;" +
            "  font-weight: 700;" +
            "  margin-bottom: 12px;" +
            "  color: #ffffff;" +
            "}" +
            ".error-message {" +
            "  font-size: 0.95rem;" +
            "  color: #94a3b8;" +
            "  line-height: 1.6;" +
            "  margin-bottom: 32px;" +
            "}" +
            ".retry-button {" +
            "  display: inline-flex;" +
            "  align-items: center;" +
            "  gap: 8px;" +
            "  padding: 14px 32px;" +
            "  background: #448aff;" +
            "  color: #ffffff;" +
            "  border: none;" +
            "  border-radius: 12px;" +
            "  font-size: 1rem;" +
            "  font-weight: 600;" +
            "  cursor: pointer;" +
            "  transition: background 0.2s;" +
            "  -webkit-tap-highlight-color: transparent;" +
            "}" +
            ".retry-button:active {" +
            "  background: #2962ff;" +
            "}" +
            ".retry-button svg {" +
            "  width: 18px;" +
            "  height: 18px;" +
            "  stroke: #ffffff;" +
            "  fill: none;" +
            "  stroke-width: 2;" +
            "  stroke-linecap: round;" +
            "  stroke-linejoin: round;" +
            "}" +
            "</style>" +
            "</head>" +
            "<body>" +
            "<div class='error-container'>" +
            "  <div class='error-icon'>" +
            "    <svg viewBox='0 0 24 24'>" +
            "      <line x1='1' y1='1' x2='23' y2='23'/>" +
            "      <path d='M16.72 11.06A10.94 10.94 0 0 1 19 12.55'/>" +
            "      <path d='M5 12.55a10.94 10.94 0 0 1 5.17-2.39'/>" +
            "      <path d='M10.71 5.05A16 16 0 0 1 22.56 9'/>" +
            "      <path d='M1.42 9a15.91 15.91 0 0 1 4.7-2.88'/>" +
            "      <path d='M8.53 16.11a6 6 0 0 1 6.95 0'/>" +
            "      <line x1='12' y1='20' x2='12.01' y2='20'/>" +
            "    </svg>" +
            "  </div>" +
            "  <h1 class='error-title'>인터넷에 연결할 수 없습니다</h1>" +
            "  <p class='error-message'>" +
            "    네트워크 연결 상태를 확인한 후<br>다시 시도해 주세요." +
            "  </p>" +
            "  <button class='retry-button' onclick='window.location.reload()'>" +
            "    <svg viewBox='0 0 24 24'>" +
            "      <polyline points='23 4 23 10 17 10'/>" +
            "      <path d='M20.49 15a9 9 0 1 1-2.12-9.36L23 10'/>" +
            "    </svg>" +
            "    다시 시도" +
            "  </button>" +
            "</div>" +
            "</body>" +
            "</html>";
    }
}
