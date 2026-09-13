# 图生视频

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /vidu/v2/img2video:
    post:
      summary: 图生视频
      deprecated: false
      description: >
        ### 参数名称及描述


        | 参数名称           | 类型         | 必填 | 参数描述 |

        |------------------|------------|------|---------|

        | `model`          | String     | 是   | 模型名称， 可选值：<br> - `viduq2-pro`:
        新模型，效果好，细节丰富<br> - `viduq2-turbo`: 新模型，效果好，生成快<br> - `viduq1`:
        画面清晰，平滑转场，运镜稳定<br> - `viduq1-classic`: 画面清晰，转场、运镜更丰富<br> - `vidu2.0`:
        生成速度快<br> - `vidu1.5`: 动态幅度大 |

        | `images`         | Array[String] | 是   | 首帧图像。支持 Base64 编码或图片
        URL，支持格式：png、jpeg、jpg、webp。图片比例需小于 1:4 或 4:1，大小不超过 50 MB。 |

        | `prompt`         | String     | 可选 | 生成视频的文本描述，字符长度不超过 2000 个字符。 |

        | `is_rec`         | Bool       | 可选 | 是否使用推荐提示词：<br> - `true`:
        系统自动推荐提示词，生成视频时使用推荐词（推荐提示词数量=1）<br> - `false`:
        使用自定义提示词生成视频。启用推荐提示词每个任务额外消耗10积分。 |

        | `duration`       | Int        | 可选 | 视频时长，依据模型默认值设置：<br> -
        `viduq2-pro`、`viduq2-turbo`、`viduq1`、`viduq1-classic`: 默认为
        5秒，可选：1、2、3、4、5、6、7、8<br> - `vidu2.0`: 默认为 4秒，可选：4、8<br> - `vidu1.5`:
        默认为 4秒，可选：4、8 |

        | `seed`           | Int        | 可选 |
        随机种子。默认不传或传0时使用随机数替代，手动设置则使用设置的种子。 |

        | `resolution`     | String     | 可选 | 分辨率：<br> - `viduq2-pro`: 1-8秒，默认
        720p，可选：540p、720p、1080p<br> - `viduq1`、`viduq1-classic`: 默认 1080p<br> -
        `vidu2.0`: 4秒默认 360p，8秒默认 720p，可选：360p、720p、1080p<br> - `vidu1.5`: 4秒默认
        360p，8秒默认 720p，可选：360p、720p、1080p |

        | `movement_amplitude` | String  | 可选 | 运动幅度：默认
        `auto`，可选值：`auto`、`small`、`medium`、`large` |

        | `bgm`            | Bool       | 可选 | 是否添加背景音乐，默认为 `false`。若
        `true`，系统自动挑选并添加合适音乐。 |

        | `payload`        | String     | 可选 | 透传参数，最大字符长度为 1048576。 |

        | `off_peak`       | Bool       | 可选 | 错峰模式，默认为
        `false`，可选值：`true`（错峰生成），`false`（即时生成）。错峰模式消耗积分较低，任务会在48小时内生成。 |

        | `watermark`      | Bool       | 可选 | 是否添加水印，`true` 表示添加水印，`false`
        表示不添加。默认不加。 |

        | `wm_position`    | Int        | 可选 | 水印位置：<br> - 1: 左上角<br> - 2:
        右上角<br> - 3: 右下角<br> - 4: 左下角<br> 默认：3 |

        | `wm_url`         | String     | 可选 | 自定义水印内容的图片 URL，若不传，使用默认水印。 |

        | `meta_data`      | String     | 可选 | 元数据标识，JSON 格式字符串，可自定义或使用示例格式。 |


        ### 示例格式


        ```json

        {
          "Label": "your_label",
          "ContentProducer": "yourcontentproducer",
          "ContentPropagator": "your_content_propagator",
          "ProduceID": "yourproductid",
          "PropagateID": "your_propagate_id",
          "ReservedCode1": "yourreservedcode1",
          "ReservedCode2": "your_reserved_code2"
        }
      tags:
        - 视频模型/vidu
      parameters:
        - name: Content-Type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                images:
                  type: array
                  items:
                    type: string
                prompt:
                  type: string
                duration:
                  type: integer
                seed:
                  type: integer
                resolution:
                  type: string
                movement_amplitude:
                  type: string
                off_peak:
                  type: boolean
              required:
                - model
                - images
                - prompt
                - duration
                - seed
                - resolution
                - movement_amplitude
                - off_peak
            example:
              model: viduq2-pro
              images:
                - >-
                  https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/image2video.png
              prompt: The astronaut waved and the camera moved up.
              duration: 5
              seed: 0
              resolution: 720p
              movement_amplitude: auto
              off_peak: false
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/vidu
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-374481658-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

# 参考生视频

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /vidu/v2/reference2video:
    post:
      summary: 参考生视频
      deprecated: false
      description: |-
        具体参数请看官方文档： 
        https://platform.vidu.cn/docs/reference-to-video
      tags:
        - 视频模型/vidu
      parameters:
        - name: Content-Type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                images:
                  type: array
                  items:
                    type: string
                prompt:
                  type: string
                duration:
                  type: integer
                seed:
                  type: integer
                resolution:
                  type: string
                movement_amplitude:
                  type: string
                off_peak:
                  type: boolean
              required:
                - model
                - images
                - prompt
                - duration
                - seed
                - resolution
                - movement_amplitude
                - off_peak
            example:
              model: viduq2-pro
              images:
                - >-
                  https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/image2video.png
              prompt: The astronaut waved and the camera moved up.
              duration: 5
              seed: 0
              resolution: 720p
              movement_amplitude: auto
              off_peak: false
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/vidu
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-374481783-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

# 首尾帧

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /vidu/v2/start-end2video:
    post:
      summary: 首尾帧
      deprecated: false
      description: |-
        具体参数请看官方文档： 
        https://platform.vidu.cn/docs/start-end-to-video
      tags:
        - 视频模型/vidu
      parameters:
        - name: Content-Type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                images:
                  type: array
                  items:
                    type: string
                prompt:
                  type: string
                duration:
                  type: integer
                seed:
                  type: integer
                resolution:
                  type: string
                movement_amplitude:
                  type: string
                off_peak:
                  type: boolean
              required:
                - model
                - images
                - prompt
                - duration
                - seed
                - resolution
                - movement_amplitude
                - off_peak
            example:
              model: viduq2-pro
              images:
                - >-
                  https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/image2video.png
              prompt: The astronaut waved and the camera moved up.
              duration: 5
              seed: 0
              resolution: 720p
              movement_amplitude: auto
              off_peak: false
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/vidu
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-374481785-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

# 文生视频

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /vidu/v2/text2video:
    post:
      summary: 文生视频
      deprecated: false
      description: |-
        具体参数请看官方文档： 
        https://platform.vidu.cn/docs/text-to-video
      tags:
        - 视频模型/vidu
      parameters:
        - name: Content-Type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                images:
                  type: array
                  items:
                    type: string
                prompt:
                  type: string
                duration:
                  type: integer
                seed:
                  type: integer
                resolution:
                  type: string
                movement_amplitude:
                  type: string
                off_peak:
                  type: boolean
              required:
                - model
                - images
                - prompt
                - duration
                - seed
                - resolution
                - movement_amplitude
                - off_peak
            example:
              model: viduq2-pro
              images:
                - >-
                  https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/image2video.png
              prompt: The astronaut waved and the camera moved up.
              duration: 5
              seed: 0
              resolution: 720p
              movement_amplitude: auto
              off_peak: false
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/vidu
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-374481802-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

# 查询任务

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /vidu/v2/tasks/{task_id}/creations:
    get:
      summary: 查询任务
      deprecated: false
      description: ''
      tags:
        - 视频模型/vidu
      parameters:
        - name: task_id
          in: path
          description: ''
          required: true
          schema:
            type: string
        - name: Content-Type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          text/plain:
            schema:
              type: string
            examples: {}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 视频模型/vidu
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-374481817-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```