from playwright.sync_api import sync_playwright
import time


def run():
    # 使用 sync_playwright 上下文管理器
    with sync_playwright() as p:
        # 启动浏览器，headless=False 表示你可以看到浏览器界面
        browser = p.chromium.launch(headless=False)

        # 创建一个新页面
        context = browser.new_context(
            # 模拟一个真实的浏览器 User-Agent，减少被反爬虫拦截的概率
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        url = "https://www.sciencedirect.com/science/article/pii/S2214914725004428?ref=cra_js_challenge&fr=RR-102&arc=HV-3&rr=9fa78124ca97c9fd"

        print(f"正在打开网页: {url}")

        try:
            # 跳转到目标网页，timeout 设置为 60 秒以防加载缓慢
            page.goto(url, timeout=60000)

            print("网页已加载，开始停留 100 秒...")

            # 停留 100 秒
            # 可以使用 time.sleep，也可以使用 page.wait_for_timeout(100000)
            page.wait_for_timeout(600000)

            print("停留结束。")

        except Exception as e:
            print(f"发生错误: {e}")

        finally:
            # 关闭浏览器
            browser.close()


if __name__ == "__main__":
    run()
