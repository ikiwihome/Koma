/**
 * 工具结果渲染器
 * 根据结果类型智能渲染：JSON、图片、表格、文本等
 */
import React from 'react';
import { Image, Typography, Table, Alert } from 'antd';


import styles from './ToolResultRenderer.module.scss';
import { cssVars } from '../../theme/runtime';

const { Text } = Typography;

interface ToolResultRendererProps {
  result: unknown;
  error?: string;
  maxHeight?: number;
}

// 检测结果类型
function detectResultType(result: unknown): 'image' | 'table' | 'json' | 'text' {
  if (typeof result === 'string') {
    // Base64 图片
    if (result.startsWith('data:image/')) return 'image';
    // URL 图片
    if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(result)) return 'image';
    return 'text';
  }

  if (Array.isArray(result)) {
    // 数组，且第一项是对象 → 表格
    if (result.length > 0 && typeof result[0] === 'object' && result[0] !== null) {
      return 'table';
    }
  }

  if (typeof result === 'object' && result !== null) {
    // 检查是否包含图片字段
    const obj = result as Record<string, unknown>;
    if (obj.image || obj.imageUrl || obj.url) {
      const imgVal = obj.image || obj.imageUrl || obj.url;
      if (typeof imgVal === 'string' && (imgVal.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(imgVal))) {
        return 'image';
      }
    }
  }

  return 'json';
}

// 从对象中提取图片URL
function extractImageUrl(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>;
    const imgVal = obj.image || obj.imageUrl || obj.url;
    if (typeof imgVal === 'string') return imgVal;
  }
  return null;
}

export const ToolResultRenderer: React.FC<ToolResultRendererProps> = ({
  result,
  error,
  maxHeight = 300,
}) => {
  const maxHeightStyle = cssVars({ '--tool-result-max-height': `${maxHeight}px` });

  if (error) {
    return (
      <Alert
        type="error"
        message="工具执行失败"
        description={error}
        showIcon
        className={styles.error}
      />
    );
  }

  if (result === undefined || result === null) {
    return (
      <Text type="secondary" className={styles.empty}>
        无返回结果
      </Text>
    );
  }

  const type = detectResultType(result);

  switch (type) {
    case 'image': {
      const url = extractImageUrl(result);
      if (!url) return null;
      return (
        <div className={styles.imageContainer}>
          <Image
            src={url}
            alt="工具返回图片"
            className={styles.image}
            fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
          />
        </div>
      );
    }

    case 'table': {
      const data = result as Record<string, unknown>[];
      if (data.length === 0) {
        return <Text type="secondary">空数据</Text>;
      }
      const columns = Object.keys(data[0]).map((key) => ({
        title: key,
        dataIndex: key,
        key,
        ellipsis: true,
      }));
      return (
        <div className={styles.tableContainer} style={maxHeightStyle}>
          <Table
            dataSource={data.map((item, i) => ({ ...item, key: i }))}
            columns={columns}
            size="small"
            pagination={false}
            scroll={{ y: maxHeight - 50 }}
          />
        </div>
      );
    }

    case 'text': {
      const text = String(result);
      return (
        <pre className={styles.text} style={maxHeightStyle}>
          {text}
        </pre>
      );
    }

    case 'json':
    default: {
      const json = JSON.stringify(result, null, 2);
      return (
        <pre className={styles.json} style={maxHeightStyle}>
          {json}
        </pre>
      );
    }
  }
};

export default ToolResultRenderer;
