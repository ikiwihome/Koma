/**
 * 新建角色弹窗
 */
import React, { useState, useCallback } from 'react';
import { Modal, Form, Input, Select, App } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';
import type { Character, CharacterGender } from '../../types';
import { saveCharacters, loadCharacters } from '../../store/projectStore';
import styles from './CreateCharacterModal.module.scss';

const { TextArea } = Input;

interface CreateCharacterModalProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreate: (character: Character) => void;
}

export const CreateCharacterModal: React.FC<CreateCharacterModalProps> = ({
  open,
  projectId,
  onClose,
  onCreate,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const newCharacter: Character = {
        id: uuidv4(),
        name: values.name,
        role: values.role || 'supporting',
        age: values.age || undefined,
        gender: values.gender || 'unknown',
        prompt: values.prompt || '',
      };

      // 保存到存储
      const characters = await loadCharacters(projectId);
      characters.push(newCharacter);
      await saveCharacters(projectId, characters);

      onCreate(newCharacter);
      form.resetFields();
      onClose();
      message.success('角色创建成功');
    } catch (err: any) {
      if (err.errorFields) {
        // 表单验证错误
        return;
      }
      message.error(err.message || '创建失败');
    } finally {
      setLoading(false);
    }
  }, [form, projectId, onCreate, onClose, message]);

  const handleCancel = useCallback(() => {
    form.resetFields();
    onClose();
  }, [form, onClose]);

  const roleOptions = [
    { value: 'protagonist', label: '主角' },
    { value: 'antagonist', label: '反派' },
    { value: 'supporting', label: '配角' },
  ];
  const genderOptions: Array<{ value: CharacterGender; label: string }> = [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
    { value: 'neutral', label: '中性' },
    { value: 'unknown', label: '未知' },
  ];

  return (
    <Modal
      title={
        <span>
          <UserAddOutlined className={styles.titleIcon} />
          新建角色
        </span>
      }
      open={open}
      onCancel={handleCancel}
      onOk={handleSubmit}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" className={styles.form}>
        <Form.Item
          name="name"
          label="角色名称"
          rules={[{ required: true, message: '请输入角色名称' }]}
        >
          <Input placeholder="如：叶青凡" />
        </Form.Item>

        <Form.Item name="role" label="角色类型" initialValue="supporting">
          <Select options={roleOptions} />
        </Form.Item>

        <Form.Item name="age" label="年龄">
          <Input placeholder="如：28岁" />
        </Form.Item>

        <Form.Item name="gender" label="性别" initialValue="unknown">
          <Select options={genderOptions} />
        </Form.Item>

        <Form.Item
          name="prompt"
          label="视觉提示词"
          rules={[{ required: true, message: '请输入角色视觉提示词' }]}
        >
          <TextArea rows={4} placeholder="只描述角色可见外貌、服装、材质、配色、体态等客观视觉信息" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateCharacterModal;
