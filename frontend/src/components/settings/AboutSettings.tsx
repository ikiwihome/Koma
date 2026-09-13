/**
 * 关于 子页（极简版）
 *
 * 只显示当前版本号与"自动更新已启用"提示。
 * 检查更新 / Beta channel / 自动检查开关 / changelog 等全部砍掉 ——
 * 所有 UX 都通过标题栏 UpdateButton 完成。
 */
import React from 'react';
import { Card, Typography } from 'antd';
import { useUpdater } from '../../hooks/useUpdater';

const { Text, Paragraph } = Typography;

export const AboutSettings: React.FC = () => {
  const { state, isAvailable } = useUpdater();

  return (
    <div className="settings-manager">
      <Card size="small" title="关于 Koma Studio">
        <Paragraph>
          <Text strong>当前版本：</Text>
          <Text code>{state?.currentVersion ?? '—'}</Text>
        </Paragraph>
        {isAvailable && (
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            已启用自动更新。发现新版本时，标题栏会出现"更新"按钮。
          </Paragraph>
        )}
      </Card>
    </div>
  );
};
