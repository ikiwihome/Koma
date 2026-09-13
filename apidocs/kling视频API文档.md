# 文生视频

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /kling/v1/videos/text2video:
    post:
      summary: 文生视频
      deprecated: false
      description: >+
        本文档不实时更新，完整版请查看官方文档：https://docs.qingque.cn/d/home/eZQClW07IFEuX1csc-VejdY2M

      tags:
        - 快手可灵(官方格式)
      parameters:
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
                prompt:
                  type: string
                  description: 正向文本提示，必须，不能超过500个字符
                  maxLength: 500
                negative_prompt:
                  type: string
                  description: 负向文本提示，可选，不能超过200个字符
                  maxLength: 200
                cfg_scale:
                  type: number
                  description: 生成视频的自由度，可选，值越大，相关性越强，取值范围：[0,1]
                  minimum: 0
                  maximum: 1
                mode:
                  type: string
                  description: 生成视频的模式，可选，枚举值：std（高性能）或 pro（高表现）
                  enum:
                    - std（高性能）
                    - pro（高表现）
                  x-apifox-enum:
                    - value: std（高性能）
                      name: ''
                      description: ''
                    - value: pro（高表现）
                      name: ''
                      description: ''
                camera_control:
                  type: object
                  properties:
                    type:
                      type: string
                    config:
                      type: object
                      properties:
                        horizontal:
                          type: integer
                          minimum: -10
                          maximum: 10
                          description: 水平运镜，可选，取值范围：[-10, 10]
                        vertical:
                          type: integer
                          minimum: -10
                          maximum: 10
                          description: 垂直运镜，可选，取值范围：[-10, 10]
                        pan:
                          type: integer
                          description: 水平摇镜，可选，取值范围：[-10, 10]
                          minimum: -10
                          maximum: 10
                        tilt:
                          type: integer
                          description: 垂直摇镜，可选，取值范围：[-10, 10]
                          minimum: -10
                          maximum: 10
                        roll:
                          type: integer
                          description: 旋转运镜，可选，取值范围：[-10, 10]
                          minimum: -10
                          maximum: 10
                        zoom:
                          type: integer
                          description: 变焦，可选，取值范围：[-10, 10]
                          minimum: -10
                          maximum: 10
                      x-apifox-orders:
                        - horizontal
                        - vertical
                        - pan
                        - tilt
                        - roll
                        - zoom
                      description: 包含六个字段，用于指定摄像机的运动或变化
                  x-apifox-orders:
                    - type
                    - config
                  description: 控制摄像机运动的协议，可选，未指定则智能匹配
                aspect_ratio:
                  type: string
                  description: 生成视频的画面纵横比，可选，枚举值：16:9, 9:16, 1:1
                  enum:
                    - '16:9'
                    - '9:16'
                    - '1:1'
                  x-apifox-enum:
                    - value: '16:9'
                      name: ''
                      description: ''
                    - value: '9:16'
                      name: ''
                      description: ''
                    - value: '1:1'
                      name: ''
                      description: ''
                duration:
                  type: string
                  description: 生成视频时长，单位秒，可选，枚举值：5，10
                  enum:
                    - '5'
                    - '10'
                  x-apifox-enum:
                    - value: '5'
                      name: ''
                      description: ''
                    - value: '10'
                      name: ''
                      description: ''
                callback_url:
                  type: string
                  description: 本次任务结果回调通知地址，可选
                model_name:
                  type: string
                  description: kling-v1、kling-v1-5、kling-v1-6
              x-apifox-orders:
                - model_name
                - prompt
                - negative_prompt
                - cfg_scale
                - mode
                - camera_control
                - aspect_ratio
                - duration
                - callback_url
              required:
                - prompt
            examples: {}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: 错误码；具体定义错误码
                  message:
                    type: string
                    description: 错误信息
                  request_id:
                    type: string
                    description: 请求ID，系统生成，用于跟踪请求、排查问题
                  data:
                    type: object
                    properties:
                      task_id:
                        type: string
                        description: |
                          任务ID，系统生成
                      task_status:
                        type: string
                        description: >-
                          任务状态，枚举值：submitted（已提交）、processing（处理中）、succeed（成功）、failed（失败）
                        enum:
                          - submitted（已提交
                          - processing（处理中）
                          - succeed（成功）
                          - failed（失败）
                        x-apifox-enum:
                          - value: submitted（已提交
                            name: ''
                            description: ''
                          - value: processing（处理中）
                            name: ''
                            description: ''
                          - value: succeed（成功）
                            name: ''
                            description: ''
                          - value: failed（失败）
                            name: ''
                            description: ''
                      created_at:
                        type: integer
                        description: 任务创建时间，Unix时间戳、单位ms
                      updated_at:
                        type: integer
                        description: 任务更新时间，Unix时间戳、单位ms
                    x-apifox-orders:
                      - task_id
                      - task_status
                      - created_at
                      - updated_at
                    required:
                      - task_id
                      - updated_at
                      - created_at
                      - task_status
                x-apifox-orders:
                  - code
                  - message
                  - request_id
                  - data
                required:
                  - code
                  - message
                  - request_id
                  - data
              example:
                code: 0
                message: string
                request_id: string
                data:
                  task_id: string
                  task_status: string
                  created_at: 0
                  updated_at: 0
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 快手可灵(官方格式)
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-216574019-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

# 文生视频查询任务(免费）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /kling/v1/images/text2video/{task_id}:
    get:
      summary: 文生视频查询任务(免费）
      deprecated: false
      description: ''
      tags:
        - 快手可灵(官方格式)
      parameters:
        - name: task_id
          in: path
          description: |
            任务ID
          required: true
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
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                  message:
                    type: string
                  request_id:
                    type: string
                  data:
                    type: object
                    properties:
                      task_id:
                        type: string
                      task_status:
                        type: string
                      task_status_msg:
                        type: string
                      created_at:
                        type: string
                      updated_at:
                        type: string
                      task_result:
                        type: object
                        properties:
                          videos:
                            type: array
                            items:
                              type: object
                              properties:
                                id:
                                  type: string
                                url:
                                  type: string
                                duration:
                                  type: string
                              x-apifox-orders:
                                - id
                                - url
                                - duration
                        x-apifox-orders:
                          - videos
                    x-apifox-orders:
                      - task_id
                      - task_status
                      - task_status_msg
                      - created_at
                      - updated_at
                      - task_result
                x-apifox-orders:
                  - code
                  - message
                  - request_id
                  - data
                required:
                  - code
                  - message
                  - request_id
                  - data
              example:
                code: 0
                message: string
                request_id: string
                data:
                  task_id: string
                  task_status: string
                  task_status_msg: string
                  created_at: 1722769557708
                  updated_at: 1722769557708
                  task_result:
                    videos:
                      - id: string
                        url: string
                        duration: string
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 快手可灵(官方格式)
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-253413276-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

# 图生视频

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /kling/v1/videos/image2video:
    post:
      summary: 图生视频
      deprecated: false
      description: >+
        本文档不实时更新，完整版请查看官方文档：https://docs.qingque.cn/d/home/eZQClW07IFEuX1csc-VejdY2M

      tags:
        - 快手可灵(官方格式)
      parameters:
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
                image:
                  type: string
                  description: >-
                    参考图像，必须，支持Base64编码或图片URL，支持.jpg / .jpeg /
                    .png格式，大小不能超过10MB，分辨率不小于300*300px
                image_tail:
                  type: string
                  description: >-
                    参考图像 - 尾帧控制，可选，支持Base64编码或图片URL，支持.jpg / .jpeg /
                    .png格式，大小不能超过10MB，分辨率不小于300*300px
                prompt:
                  type: string
                  description: 正向文本提示， 可选，不能超过500个字符
                  maxLength: 5000
                negative_prompt:
                  type: string
                  description: 负向文本提示，可选，不能超过200个字符
                  maxLength: 2000
                cfg_scale:
                  type: number
                  description: 生成视频的自由度，可选，值越大相关性越强，取值范围：[0, 1]
                  minimum: 0
                  maximum: 1
                mode:
                  type: string
                  description: 生成视频的模式，可选，枚举值：std（高性能）或 pro（高表现）
                  enum:
                    - std（高性能）
                    - pro（高表现）
                  x-apifox-enum:
                    - value: std（高性能）
                      name: ''
                      description: ''
                    - value: pro（高表现）
                      name: ''
                      description: ''
                duration:
                  type: string
                  description: 生成视频时长，单位秒，可选，枚举值：5，10（包含尾帧的请求仅支持5秒）
                  enum:
                    - '5'
                    - '10'
                  x-apifox-enum:
                    - value: '5'
                      name: ''
                      description: ''
                    - value: '10'
                      name: ''
                      description: ''
                callback_url:
                  type: string
                  description: 本次任务结果回调通知地址，可选
                model_name:
                  type: string
                  description: kling-v1、kling-v1-5、kling-v1-6
              x-apifox-orders:
                - model_name
                - image
                - image_tail
                - prompt
                - negative_prompt
                - cfg_scale
                - mode
                - duration
                - callback_url
              required:
                - image
            examples: {}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: 错误码；具体定义错误码
                  message:
                    type: string
                    description: 错误信息
                  request_id:
                    type: string
                    description: 请求ID，系统生成，用于跟踪请求、排查问题
                  data:
                    type: object
                    properties:
                      task_id:
                        type: string
                        description: 任务ID，系统生成
                      task_status:
                        type: string
                        description: >-
                          任务状态，枚举值：submitted（已提交）、processing（处理中）、succeed（成功）、failed（失败）
                        enum:
                          - submitted（已提交）
                          - processing（处理中）
                          - succeed（成功）
                          - failed（失败）
                        x-apifox-enum:
                          - value: submitted（已提交）
                            name: ''
                            description: ''
                          - value: processing（处理中）
                            name: ''
                            description: ''
                          - value: succeed（成功）
                            name: ''
                            description: ''
                          - value: failed（失败）
                            name: ''
                            description: ''
                      created_at:
                        type: integer
                        description: 任务创建时间，Unix时间戳、单位ms
                      updated_at:
                        type: integer
                        description: 任务更新时间，Unix时间戳、单位ms
                    x-apifox-orders:
                      - task_id
                      - task_status
                      - created_at
                      - updated_at
                    required:
                      - task_id
                      - task_status
                      - created_at
                      - updated_at
                x-apifox-orders:
                  - code
                  - message
                  - request_id
                  - data
                required:
                  - code
                  - message
                  - request_id
                  - data
              example:
                code: 0
                message: string
                request_id: string
                data:
                  task_id: string
                  task_status: string
                  created_at: 0
                  updated_at: 0
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 快手可灵(官方格式)
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-216574020-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

# 图生视频查询任务(免费） 

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /kling/v1/images/image2video/{task_id}:
    get:
      summary: '图生视频查询任务(免费） '
      deprecated: false
      description: ''
      tags:
        - 快手可灵(官方格式)
      parameters:
        - name: task_id
          in: path
          description: |
            任务ID
          required: true
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
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                  message:
                    type: string
                  request_id:
                    type: string
                  data:
                    type: object
                    properties:
                      task_id:
                        type: string
                      task_status:
                        type: string
                      task_status_msg:
                        type: string
                      created_at:
                        type: string
                      updated_at:
                        type: string
                      task_result:
                        type: object
                        properties:
                          videos:
                            type: array
                            items:
                              type: object
                              properties:
                                id:
                                  type: string
                                url:
                                  type: string
                                duration:
                                  type: string
                              x-apifox-orders:
                                - id
                                - url
                                - duration
                        x-apifox-orders:
                          - videos
                    x-apifox-orders:
                      - task_id
                      - task_status
                      - task_status_msg
                      - created_at
                      - updated_at
                      - task_result
                x-apifox-orders:
                  - code
                  - message
                  - request_id
                  - data
                required:
                  - code
                  - message
                  - request_id
                  - data
              example:
                code: 0
                message: string
                request_id: string
                data:
                  task_id: string
                  task_status: string
                  task_status_msg: string
                  created_at: 1722769557708
                  updated_at: 1722769557708
                  task_result:
                    videos:
                      - id: string
                        url: string
                        duration: string
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 快手可灵(官方格式)
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-414663125-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 多图参考生视频

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /kling/v1/videos/multi-image2video:
    post:
      summary: 多图参考生视频
      deprecated: false
      description: >+
        本文档不实时更新，完整版请查看官方文档：https://app.klingai.com/cn/dev/document-api/apiReference/model/multiImageToVideo

      tags:
        - 快手可灵(官方格式)
      parameters:
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
                prompt:
                  type: string
                  description: 正向文本提示， 可选，不能超过500个字符
                  maxLength: 5000
                  x-apifox-mock: 动起来
                negative_prompt:
                  type: string
                  description: 负向文本提示，可选，不能超过200个字符
                  maxLength: 2000
                cfg_scale:
                  type: number
                  description: 生成视频的自由度，可选，值越大相关性越强，取值范围：[0, 1]
                  minimum: 0
                  maximum: 1
                mode:
                  type: string
                  description: 生成视频的模式，可选，枚举值：std（高性能）或 pro（高表现）
                  enum:
                    - std
                    - pro
                  x-apifox-enum:
                    - value: std
                      name: （高性能）
                      description: ''
                    - value: pro
                      name: （高表现）
                      description: ''
                duration:
                  type: string
                  description: 生成视频时长，单位秒，可选，枚举值：5，10（包含尾帧的请求仅支持5秒）
                  enum:
                    - '5'
                    - '10'
                  x-apifox-enum:
                    - value: '5'
                      name: ''
                      description: ''
                    - value: '10'
                      name: ''
                      description: ''
                callback_url:
                  type: string
                  description: 本次任务结果回调通知地址，可选
                model_name:
                  type: string
                  description: kling-v1-6
                  x-apifox-mock: kling-v1-6
                image_list:
                  type: array
                  items:
                    type: object
                    properties:
                      image:
                        type: string
                        x-apifox-mock: https://webstatic.aiproxy.vip/dist/demo.jpg
                    x-apifox-orders:
                      - image
                    required:
                      - image
                  description: >-
                    参考图像，必须，支持Base64编码或图片URL，支持.jpg / .jpeg /
                    .png格式，大小不能超过10MB，分辨率不小于300*300px
              x-apifox-orders:
                - model_name
                - image_list
                - prompt
                - negative_prompt
                - cfg_scale
                - mode
                - duration
                - callback_url
              required:
                - image_list
                - model_name
                - prompt
            example:
              model_name: kling-v1-6
              image_list:
                - image: https://webstatic.aiproxy.vip/dist/demo.jpg
                - image: https://webstatic.aiproxy.vip/dist/demo.jpg
              prompt: 动起来，然后再回到原来
              mode: std
              duration: '5'
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: 错误码；具体定义错误码
                  message:
                    type: string
                    description: 错误信息
                  request_id:
                    type: string
                    description: 请求ID，系统生成，用于跟踪请求、排查问题
                  data:
                    type: object
                    properties:
                      task_id:
                        type: string
                        description: 任务ID，系统生成
                      task_status:
                        type: string
                        description: >-
                          任务状态，枚举值：submitted（已提交）、processing（处理中）、succeed（成功）、failed（失败）
                        enum:
                          - submitted（已提交）
                          - processing（处理中）
                          - succeed（成功）
                          - failed（失败）
                        x-apifox-enum:
                          - value: submitted（已提交）
                            name: ''
                            description: ''
                          - value: processing（处理中）
                            name: ''
                            description: ''
                          - value: succeed（成功）
                            name: ''
                            description: ''
                          - value: failed（失败）
                            name: ''
                            description: ''
                      created_at:
                        type: integer
                        description: 任务创建时间，Unix时间戳、单位ms
                      updated_at:
                        type: integer
                        description: 任务更新时间，Unix时间戳、单位ms
                    x-apifox-orders:
                      - task_id
                      - task_status
                      - created_at
                      - updated_at
                    required:
                      - task_id
                      - task_status
                      - created_at
                      - updated_at
                x-apifox-orders:
                  - code
                  - message
                  - request_id
                  - data
                required:
                  - code
                  - message
                  - request_id
                  - data
              example:
                code: 0
                message: string
                request_id: string
                data:
                  task_id: string
                  task_status: string
                  created_at: 0
                  updated_at: 0
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 快手可灵(官方格式)
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-327714825-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```

# 多图参考生视频查询任务(免费 ）

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /kling/v1/videos/multi-image2video/{task_id}:
    get:
      summary: 多图参考生视频查询任务(免费 ）
      deprecated: false
      description: ''
      tags:
        - 快手可灵(官方格式)
      parameters:
        - name: task_id
          in: path
          description: |
            任务ID
          required: true
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
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                  message:
                    type: string
                  request_id:
                    type: string
                  data:
                    type: object
                    properties:
                      task_id:
                        type: string
                      task_status:
                        type: string
                      task_status_msg:
                        type: string
                      created_at:
                        type: string
                      updated_at:
                        type: string
                      task_result:
                        type: object
                        properties:
                          videos:
                            type: array
                            items:
                              type: object
                              properties:
                                id:
                                  type: string
                                url:
                                  type: string
                                duration:
                                  type: string
                              x-apifox-orders:
                                - id
                                - url
                                - duration
                        x-apifox-orders:
                          - videos
                    x-apifox-orders:
                      - task_id
                      - task_status
                      - task_status_msg
                      - created_at
                      - updated_at
                      - task_result
                x-apifox-orders:
                  - code
                  - message
                  - request_id
                  - data
                required:
                  - code
                  - message
                  - request_id
                  - data
              example:
                code: 0
                message: string
                request_id: string
                data:
                  task_id: string
                  task_status: string
                  task_status_msg: string
                  created_at: 1722769557708
                  updated_at: 1722769557708
                  task_result:
                    videos:
                      - id: string
                        url: string
                        duration: string
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 快手可灵(官方格式)
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-414668029-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```