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
import type { CourseDetail, PaperStatus, PaperSummary } from '@exam-maker/shared';
import { copyPaper, createPaper, deletePaper, listPapers } from '../services/paper';
import { listCourses } from '../services/course';
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
  courseId?: number;
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

const PaperList: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm<PaperFormValues>();
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [courses, setCourses] = useState<CourseDetail[]>([]);
  const [filters, setFilters] = useState<{ status?: PaperStatus; courseId?: number; search?: string }>({});
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setPapers(await listPapers(filters));
    } catch (error) {
      message.error(errorMessage(error, '加载试卷失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filters.status, filters.courseId]);
  useEffect(() => { listCourses().then(setCourses).catch(() => undefined); }, []);

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

  const columns: TableColumnsType<PaperSummary> = [
    { title: '试卷名称', dataIndex: 'title', ellipsis: true },
    { title: '课程', dataIndex: 'course', width: 180, ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (_: PaperStatus, item) => <Tag color={item.displayStatus === 'ready' ? 'success' : item.displayStatus === 'used' ? 'blue' : 'default'}>{item.displayStatus === 'used' ? '已使用' : paperStatusLabels[item.status]}</Tag>,
    },
    { title: '题目数', dataIndex: 'questionCount', width: 90 },
    { title: '总分', dataIndex: 'totalScore', width: 90, render: (score: number) => `${score} 分` },
    { title: '难度', dataIndex: 'estimatedDifficulty', width: 90, render: (value) => value || '未估算' },
    { title: '创建方式', dataIndex: 'creationMethod', width: 100, render: (value) => ({ ai_generated: 'AI 生成', manual: '人工组卷', imported: '历史导入' }[value as PaperSummary['creationMethod']]) },
    { title: '使用次数', dataIndex: 'usageCount', width: 90 },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (value: string) => new Date(value).toLocaleString('zh-CN') },
    {
      title: '操作', key: 'actions', width: 150,
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/papers/${record.id}`)}>编辑</Button>
          <Button size="small" onClick={async () => { const copied = await copyPaper(record.id); message.success('试卷已复制'); navigate(`/papers/${copied.id}`); }}>复制</Button>
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
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search allowClear placeholder="搜索试卷名称" style={{ width: 260 }} value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value || undefined }))} onSearch={() => load()} />
        <Select allowClear placeholder="课程" style={{ width: 180 }} value={filters.courseId} options={courses.map((course) => ({ value: course.id, label: course.name }))} onChange={(courseId) => setFilters((current) => ({ ...current, courseId }))} />
        <Select allowClear placeholder="状态" style={{ width: 140 }} value={filters.status} options={Object.entries(paperStatusLabels).map(([value, label]) => ({ value, label }))} onChange={(status) => setFilters((current) => ({ ...current, status }))} />
      </Space>
      <Table<PaperSummary>
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
        destroyOnHidden
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
