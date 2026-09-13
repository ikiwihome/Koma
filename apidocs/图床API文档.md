API 端点
所有API请求都应发送到以下URL：

POST /api/v1.php

请求体必须使用 multipart/form-data 格式进行编码。

请求参数
参数名	类型	必需	描述
image	File	是	要上传的图片文件。支持的格式包括：jpg, png, webp, bmp, tiff, gif。
outputFormat	String	否	输出格式（auto, jpeg, png, webp, gif, webp_animated），默认为 auto。
webp: 输出静态WebP。如果输入是动图，则只转换第一帧。
gif: 输出优化后的GIF动图。
webp_animated: 输出动态WebP。
为了获得更好的压缩率和显示效果，我们强烈建议将静态图片转换为 webp，将动态图片转换为 webp_animated。
password_enabled	String	否	设为 "true" 以启用密码保护。必须与 image_password 参数一同使用。
image_password	String	否	为图片设置的访问密码。当 password_enabled 为 "true" 时此项为必需。
cdn_domain	String	否	指定图片外链使用的CDN域名。具体可用域名请参考下方的“可用 CDN 域名”列表。如果不指定，将使用系统默认域名。
可用 CDN 域名
您可以在上传时通过 cdn_domain 参数指定以下任意一个域名。如果不指定，系统将自动选择。

名称	域名
失控的防御系统	img.scdn.io
CloudFlare	cloudflareimg.cdn.sn
EdgeOne	edgeoneimg.cdn.sn
ESA	esaimg.cdn1.vip
响应格式
API 的响应将采用 JSON 格式。

成功响应示例 (公开图片):
{
  "success": true,
  "url": "https://img.scdn.io/i/6640c49c7161b_1715519644.webp",
  "data": {
    "filename": "6640c49c7161b_1715519644.webp",
    "original_size": 102400,
    "compressed_size": 20480,
    "compression_ratio": 80
  }
}
成功响应示例 (带密码):
{
  "success": true,
  "url": "https://img.scdn.io/p/unique_encrypted_id_string.webp"
}
秒传成功响应示例:
{
  "success": true,
  "url": "https://img.scdn.io/i/existing_image_name.webp",
  "message": "图片已存在，秒传成功！"
}
失败响应示例:
{
  "success": false,
  "message": "请求过于频繁，请稍后再试。"
}