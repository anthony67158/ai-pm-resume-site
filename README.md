# AI PM Resume Site

AI 产品经理简历 Skill 的公开介绍与购买入口。

页面按真实使用路径组织：

- 最终排版结果预览
- 20 秒输入 / 处理 / 输出摘要
- 四步安装与使用流程
- 虚构教学案例的改写前后
- 6 款代表模板与 18 款总览
- ¥9.9 微信 / 支付宝支付入口

## 本地预览

```bash
python3 -m http.server 4173
```

打开 `http://127.0.0.1:4173`。

## 收款码接入

页面已预留微信和支付宝两个独立二维码配置位。收到收款码后：

1. 将图片放到 `assets/wechat-qr.png` 与 `assets/alipay-qr.png`。
2. 在 `index.html` 的 `#commerce` 元素上设置：

```html
data-wechat-src="assets/wechat-qr.png"
data-alipay-src="assets/alipay-qr.png"
```

配置前页面会明确显示“收款码待上传”，不会伪装成可付款状态。

## 边界

- 本仓库只包含公开商品页，不包含私有 Skill 源码或付费安装包。
- 页面不收集简历、订单、邮箱或其他个人信息。
- 当前为二维码直付入口，不具备自动订单核验和自动发货能力。
- 页面中的人物、公司、经历和数字均为合成教学素材。
