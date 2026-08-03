import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Paper, PaperStatus } from '@exam-maker/shared';
import { createPaper, deletePaper, listPapers } from '../services/paper';
import { paperStatusLabels } from '../utils/examLabels';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface PaperFormValues {
  title: string;
  course: string;
  description?: string;
  instructions?: string;
  durationMinutes: number;
  status: PaperStatus;
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

const PaperList: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm<PaperFormValues>();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setPapers(await listPapers());
    } catch (error) {
      message.error(errorMessage(error, '加载试卷失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (values: PaperFormValues) => {
    setCreating(true);
    try {
      const paper = await createPaper(values);
      message.success('试卷创建成功');
      setModalOpen(false);
      form.resetFields();
      navigate(`/papers/${paper.id}`);
    } catch (error) {
      message.error(errorMessage(error, '创建试卷失败'));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deletePaper(id);
      message.success('试卷已删除');
      await load();
    } catch (error) {
      message.error(errorMessage(error, '删除试卷失败'));
    }
  };

  const columns: TableColumnsType<Paper> = [
    { title: '试卷名称', dataIndex: 'title', ellipsis: true },
    { title: '课程', dataIndex: 'course', width: 180, ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (status: PaperStatus) => <Tag color={status === 'ready' ? 'success' : 'default'}>{paperStatusLabels[status]}</Tag>,
    },
    { title: '题目数', key: 'questionCount', width: 90, render: () => <Text type="secondary">进入查看</Text> },
    { title: '总分', dataIndex: 'totalScore', width: 90, render: (score: number) => `${score} 分` },
    { title: '时长', dataIndex: 'durationMinutes', width: 100, render: (minutes: number) => `${minutes} 分钟` },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (value: string) => new Date(value).toLocaleString('zh-CN') },
    {
      title: '操作', key: 'actions', width: 150,
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/papers/${record.id}`)}>编辑</Button>
          <Popconfirm title="确认删除这份试卷？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>试卷管理</Title>
          <Text type="secondary">创建试卷并从已审核题库中选择题目。</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>新建试卷</Button>
        </Space>
      </div>
      <Table<Paper>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={papers}
        pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 份试卷` }}
      />

      <Modal
        title="新建试卷"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={creating}
        destroyOnClose
      >
        <Form<PaperFormValues>
          form={form}
          layout="vertical"
          initialValues={{ durationMinutes: 120, status: 'draft' }}
          onFinish={handleCreate}
          preserve={false}
        >
          <Form.Item name="title" label="试卷名称" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="course" label="课程" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="instructions" label="考试须知">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="durationMinutes" label="建议时长（分钟）" rules={[{ required: true }]}>
            <InputNumber min={1} max={1440} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={Object.entries(paperStatusLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PaperList;
