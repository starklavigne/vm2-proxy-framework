import requests

url = "https://www.sciencedirect.com/science/article/pii/S2214914725004428?ref=cra_js_challenge&fr=RR-102&arc=HV-3&rr=9fa78124ca97c9fd"

payload = {}
headers = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'priority': 'u=0, i',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-arch': '"arm"',
    'sec-ch-ua-bitness': '"64"',
    'sec-ch-ua-full-version': '"148.0.7778.97"',
    'sec-ch-ua-full-version-list': '"Chromium";v="148.0.7778.97", "Google Chrome";v="148.0.7778.97", "Not/A)Brand";v="99.0.0.0"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform': '"macOS"',
    'sec-ch-ua-platform-version': '"15.6.1"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Cookie': 'cf_clearance=5V2XdoJEjhKeUE1DmWz2YcZihWY6LI4lNkJHAbDTCrs-1779091338-1.3.1.1-1abLO1V4.g2loxxeof4Yvay6GdqDShufbPGda7W27nVBmg0hai2RYysFXpAGJeks0voRymNmqxYz8leEyiYyafWk09yZ1MGVpamu61MvQPMjHbRfl8ppiMHUFB92gsgR.1qghXTKdGO0duBPP9CdUBgtA5u7JiCV9roN05EvNr5aNalcpIpNQ9qAUKZNshaMxhoAjSZcCHB98XuKbun7XBMuH9k0HLyIR8Jh.DHA1Cojrkp8FGYI6GdnZfIFqXV_LeTRYRYNoyK2pr.t2tHPf2CkO_kP1hrMe6Jd1UvCatnndSrQ3BmjFSleRF1Pk0OEN.RnaAoMy6Gkn3fmmgs681I0svzAOFSIGUNRjNDO9id_164jzRJWXLz8tWBHC54kg66l5Kz4hVrEnlYAmAVtdn5.WXFZbkJVCjQtHGthLqE'
}

response = requests.request("GET", url, headers=headers, data=payload)

print(response.text)
