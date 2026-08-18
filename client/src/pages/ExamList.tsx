import React, { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
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
import { EditOutlined, PlusOutlined, ReloadOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { BarChartOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ExamStatus, Paper, TeacherExamSummary } from '@exam-maker/shared';
import { listPapers } from '../services/paper';
import {
  closeExam,
  createExam,
  listTeacherExams,
  publishExam,
  updateExam,
} from '../services/exam';

const { Title, Text } = Typography;

interface ExamFormValues {
  paperId: number;
  title: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  allowedAttempts: number;
  fillBlankIgnoreCase: boolean;
  showAnswers: boolean;
  showAnalysis: boolean;
  gradeReviewEnabled: boolean;
  gradeReviewDeadline?: string;
}

const statusLabels: Record<ExamStatus, string> = {
  draft: '草稿',
  published: '已发布',
  closed: '已关闭',
};

const statusColors: Record<ExamStatus, string> = {
  draft: 'default',
  published: 'processing',
  closed: 'error',
};

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const ExamList: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm<ExamFormValues>();
  const [exams, setExams] = useState<TeacherExamSummary[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TeacherExamSummary | null>(null);
  const gradeReviewEnabled = Form.useWatch('gradeReviewEnabled', form);

  const load = async () => {
    setLoading(true);
    try {
      const [examRows, paperRows] = await Promise.all([listTeacherExams(), listPapers()]);
      setExams(examRows);
      setPapers(paperRows.filter((paper) => paper.totalScore > 0 && paper.status !== 'archived'));
    } catch (error) {
      message.error(errorMessage(error, '加载考试列表失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      paperId: undefined as unknown as number,
      title: '',
      startAt: '',
      endAt: '',
      durationMinutes: 120,
      allowedAttempts: 1,
      fillBlankIgnoreCase: false,
      showAnswers: false,
      showAnalysis: false,
      gradeReviewEnabled: false,
      gradeReviewDeadline: '',
    });
    setModalOpen(true);
  };

  const openEdit = (exam: TeacherExamSummary) => {
    setEditing(exam);
    form.setFieldsValue({
      paperId: exam.paperId,
      title: exam.title,
      startAt: toLocalInput(exam.startAt),
      endAt: toLocalInput(exam.endAt),
      durationMinutes: exam.durationMinutes,
      allowedAttempts: exam.allowedAttempts,
      fillBlankIgnoreCase: exam.fillBlankIgnoreCase,
      showAnswers: exam.showAnswers,
      showAnalysis: exam.showAnalysis,
      gradeReviewEnabled: exam.gradeReviewEnabled,
      gradeReviewDeadline: toLocalInput(exam.gradeReviewDeadline),
    });
    setModalOpen(true);
  };

  const saveDraft = async (values: ExamFormValues) => {
    setSaving(true);
    try {
      const payload = {
        ...values,
        startAt: new Date(values.startAt).toISOString(),
        endAt: new Date(values.endAt).toISOString(),
        gradeReviewDeadline: values.gradeReviewEnabled && values.gradeReviewDeadline ? new Date(values.gradeReviewDeadline).toISOString() : null,
      };
      if (editing) await updateExam(editing.id, payload);
      else await createExam(payload);
      message.success(editing ? '考试草稿已更新' : '考试草稿已创建');
      setModalOpen(false);
      await load();
    } catch (error) {
      message.error(errorMessage(error, '保存考试草稿失败'));
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async (id: number) => {
    try {
      await publishExam(id);
      message.success('考试已发布，并已分配给当前所有学生');
      await load();
    } catch (error) {
      message.error(errorMessage(error, '发布考试失败'));
    }
  };

  const handleClose = async (id: number) => {
    try {
      await closeExam(id);
      message.success('考试已关闭');
      await load();
    } catch (error) {
      message.error(errorMessage(error, '关闭考试失败'));
    }
  };

  const columns: TableColumnsType<TeacherExamSummary> = [
    { title: '考试名称', dataIndex: 'title', ellipsis: true },
    { title: '使用试卷', dataIndex: 'paperTitle', width: 180, ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (status: ExamStatus) => <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>,
    },
    {
      title: '考试时间', key: 'time', width: 300,
      render: (_, exam) => `${exam.startAt ? new Date(exam.startAt).toLocaleString('zh-CN') : '-'} ～ ${exam.endAt ? new Date(exam.endAt).toLocaleString('zh-CN') : '-'}`,
    },
    { title: '时长', dataIndex: 'durationMinutes', width: 90, render: (value: number) => `${value} 分钟` },
    { title: '次数', dataIndex: 'allowedAttempts', width: 80, render: (value: number) => `${value} 次` },
    { title: '学生', dataIndex: 'assignmentCount', width: 80 },
    { title: '作答', dataIndex: 'attemptCount', width: 80 },
    {
      title: '操作', key: 'actions', width: 230, fixed: 'right',
      render: (_, exam) => (
        <Space>
          {exam.status === 'draft' && (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(exam)}>编辑</Button>
              <Popconfirm title="发布后试卷将被锁定，确认发布？" onConfirm={() => handlePublish(exam.id)}>
                <Button size="small" type="primary" icon={<SendOutlined />}>发布</Button>
              </Popconfirm>
            </>
          )}
          {exam.status === 'published' && (
            <>
              <Button size="small" icon={<BarChartOutlined />} onClick={() => navigate(`/exams/${exam.id}/results`)}>成绩</Button>
              <Popconfirm title="确认关闭考试？关闭后学生不能再开始新的作答。" onConfirm={() => handleClose(exam.id)}>
                <Button size="small" danger icon={<StopOutlined />}>关闭</Button>
              </Popconfirm>
            </>
          )}
          {exam.status === 'closed' && (
            <Button size="small" icon={<BarChartOutlined />} onClick={() => navigate(`/exams/${exam.id}/results`)}>查看成绩</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>考试管理</Title>
          <Text type="secondary">从已有试卷创建考试。MVP 发布范围为当前所有学生账号。</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>创建考试</Button>
        </Space>
      </div>
      <Table<TeacherExamSummary>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={exams}
        scroll={{ x: 1250 }}
        pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 场考试` }}
      />

      <Modal
        title={editing ? '编辑考试草稿' : '创建考试草稿'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText="保存草稿"
        confirmLoading={saving}
        width={620}
      >
        <Form<ExamFormValues> form={form} layout="vertical" onFinish={saveDraft}>
          <Form.Item name="paperId" label="选择试卷" rules={[{ required: true, message: '请选择试卷' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={papers.map((paper) => ({
                value: paper.id,
                label: `${paper.title}（${paper.totalScore} 分）`,
              }))}
              placeholder={papers.length ? '请选择已组好的试卷' : '暂无可用试卷，请先完成组卷'}
            />
          </Form.Item>
          <Form.Item name="title" label="考试名称" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="startAt" label="开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
              <Input type="datetime-local" />
            </Form.Item>
            <Form.Item name="endAt" label="结束时间" dependencies={['startAt']} rules={[
              { required: true, message: '请选择结束时间' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || !getFieldValue('startAt') || new Date(value) > new Date(getFieldValue('startAt'))) return Promise.resolve();
                  return Promise.reject(new Error('结束时间必须晚于开始时间'));
                },
              }),
            ]}>
              <Input type="datetime-local" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="durationMinutes" label="考试时长（分钟）" rules={[{ required: true }]}>
              <InputNumber min={1} max={1440} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="allowedAttempts" label="允许作答次数" rules={[{ required: true }]}>
              <InputNumber min={1} max={20} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="fillBlankIgnoreCase" valuePropName="checked">
            <Checkbox>填空题判分忽略英文字母大小写</Checkbox>
          </Form.Item>
          <Form.Item name="gradeReviewEnabled" valuePropName="checked">
            <Checkbox>允许学生在限定时间内申请成绩复核</Checkbox>
          </Form.Item>
          {gradeReviewEnabled && <Form.Item name="gradeReviewDeadline" label="复核申请截止时间" dependencies={['endAt']} rules={[{ required: true, message: '请选择复核截止时间' }]}>
            <Input type="datetime-local" />
          </Form.Item>}
          <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
            <Text strong>学生提交后可见内容</Text>
            <Form.Item name="showAnswers" valuePropName="checked" noStyle>
              <Checkbox>允许学生查看标准答案</Checkbox>
            </Form.Item>
            <Form.Item name="showAnalysis" valuePropName="checked" noStyle>
              <Checkbox>允许学生查看题目解析</Checkbox>
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
};

export default ExamList;
