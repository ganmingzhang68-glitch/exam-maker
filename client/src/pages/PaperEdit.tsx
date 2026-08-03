import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type {
  DifficultyLevel,
  PaperDetail,
  PaperQuestionDetail,
  PaperStatus,
  QuestionListItem,
  QuestionSource,
  QuestionType,
} from '@exam-maker/shared';
import { listQuestionSources, listQuestions } from '../services/question';
import {
  addQuestionToPaper,
  getPaper,
  removePaperQuestion,
  reorderPaperQuestions,
  updatePaper,
  updatePaperQuestion,
} from '../services/paper';
import { difficultyLabels, paperStatusLabels, questionTypeLabels } from '../utils/examLabels';

const { Title, Text, Paragraph } = Typography;
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

const PaperEdit: React.FC = () => {
  const { id } = useParams();
  const paperId = Number(id);
  const navigate = useNavigate();
  const [form] = Form.useForm<PaperFormValues>();
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorLoading, setSelectorLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState<QuestionListItem[]>([]);
  const [sources, setSources] = useState<QuestionSource[]>([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([]);
  const [draftScores, setDraftScores] = useState<Record<number, number>>({});
  const [questionFilters, setQuestionFilters] = useState<{
    type?: QuestionType;
    difficulty?: DifficultyLevel;
    sourceFileId?: number;
  }>({});

  const loadPaper = useCallback(async () => {
    if (!Number.isInteger(paperId) || paperId <= 0) {
      navigate('/papers', { replace: true });
      return;
    }
    setLoading(true);
    try {
      const data = await getPaper(paperId);
      setPaper(data);
      setDraftScores(Object.fromEntries(data.questions.map((item) => [item.id, item.score])));
      form.setFieldsValue({
        title: data.title,
        course: data.course,
        description: data.description ?? undefined,
        instructions: data.instructions ?? undefined,
        durationMinutes: data.durationMinutes,
        status: data.status,
      });
    } catch (error) {
      message.error(errorMessage(error, '加载试卷失败'));
      navigate('/papers', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [form, navigate, paperId]);

  useEffect(() => {
    loadPaper();
    listQuestionSources().then(setSources).catch(() => undefined);
  }, [loadPaper]);

  const existingQuestionIds = useMemo(
    () => new Set(paper?.questions.map((item) => item.questionId) ?? []),
    [paper],
  );

  const loadCandidates = useCallback(async () => {
    if (!selectorOpen) return;
    setSelectorLoading(true);
    try {
      const rows = await listQuestions({ status: 'reviewed', ...questionFilters, limit: 100 });
      setCandidates(rows.filter((item) => !existingQuestionIds.has(item.id)));
    } catch (error) {
      message.error(errorMessage(error, '加载可选题目失败'));
    } finally {
      setSelectorLoading(false);
    }
  }, [existingQuestionIds, questionFilters, selectorOpen]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  const savePaper = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const updated = await updatePaper(paperId, {
        ...values,
        description: values.description?.trim() || null,
        instructions: values.instructions?.trim() || null,
      });
      setPaper((current) => current ? { ...current, ...updated } : current);
      message.success('试卷信息已保存');
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      message.error(errorMessage(error, '保存试卷失败'));
    } finally {
      setSaving(false);
    }
  };

  const saveScore = async (item: PaperQuestionDetail) => {
    const score = draftScores[item.id];
    if (score === undefined || score === item.score) return;
    try {
      const updated = await updatePaperQuestion(paperId, item.id, { score });
      setPaper(updated);
      setDraftScores(Object.fromEntries(updated.questions.map((question) => [question.id, question.score])));
      message.success('分值和总分已更新');
    } catch (error) {
      setDraftScores((current) => ({ ...current, [item.id]: item.score }));
      message.error(errorMessage(error, '更新分值失败'));
    }
  };

  const moveQuestion = async (index: number, direction: -1 | 1) => {
    if (!paper) return;
    const target = index + direction;
    if (target < 0 || target >= paper.questions.length) return;
    const ids = paper.questions.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      const updated = await reorderPaperQuestions(paperId, ids);
      setPaper(updated);
      message.success('题目顺序已保存');
    } catch (error) {
      message.error(errorMessage(error, '调整顺序失败'));
    }
  };

  const removeQuestion = async (paperQuestionId: number) => {
    try {
      const updated = await removePaperQuestion(paperId, paperQuestionId);
      setPaper(updated);
      setDraftScores(Object.fromEntries(updated.questions.map((item) => [item.id, item.score])));
      message.success('题目已从试卷移除');
    } catch (error) {
      message.error(errorMessage(error, '移除题目失败'));
    }
  };

  const addSelectedQuestions = async () => {
    if (selectedQuestionIds.length === 0) return;
    setAdding(true);
    try {
      let updated = paper!;
      for (const questionId of selectedQuestionIds) {
        updated = await addQuestionToPaper(paperId, questionId);
      }
      setPaper(updated);
      setDraftScores(Object.fromEntries(updated.questions.map((item) => [item.id, item.score])));
      setSelectedQuestionIds([]);
      setSelectorOpen(false);
      message.success(`已加入 ${selectedQuestionIds.length} 道题`);
    } catch (error) {
      message.error(errorMessage(error, '添加题目失败'));
      await loadPaper();
    } finally {
      setAdding(false);
    }
  };

  const paperColumns: TableColumnsType<PaperQuestionDetail> = [
    {
      title: '顺序',
      dataIndex: 'orderNo',
      width: 120,
      render: (orderNo: number, _, index) => (
        <Space size={2}>
          <Text strong>{orderNo}</Text>
          <Button size="small" type="text" disabled={index === 0} icon={<ArrowUpOutlined />} onClick={() => moveQuestion(index, -1)} />
          <Button
            size="small"
            type="text"
            disabled={index === (paper?.questions.length ?? 0) - 1}
            icon={<ArrowDownOutlined />}
            onClick={() => moveQuestion(index, 1)}
          />
        </Space>
      ),
    },
    {
      title: '题目',
      key: 'question',
      render: (_, item) => (
        <div>
          <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 4 }}>{item.question.stem}</Paragraph>
          <Space size={4}>
            <Tag>{questionTypeLabels[item.question.type]}</Tag>
            {item.question.difficulty && <Tag>{difficultyLabels[item.question.difficulty]}</Tag>}
          </Space>
        </div>
      ),
    },
    {
      title: '分值',
      dataIndex: 'score',
      width: 130,
      render: (_, item) => (
        <InputNumber
          min={0}
          max={1000}
          value={draftScores[item.id]}
          addonAfter="分"
          onChange={(value) => {
            if (value !== null) setDraftScores((current) => ({ ...current, [item.id]: value }));
          }}
          onBlur={() => saveScore(item)}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      render: (_, item) => (
        <Popconfirm title="确认从试卷中移除？" onConfirm={() => removeQuestion(item.id)}>
          <Button danger type="text" icon={<DeleteOutlined />}>移除</Button>
        </Popconfirm>
      ),
    },
  ];

  const candidateColumns: TableColumnsType<QuestionListItem> = [
    {
      title: '题目', dataIndex: 'stem',
      render: (stem: string) => <Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>{stem}</Paragraph>,
    },
    { title: '题型', dataIndex: 'type', width: 100, render: (type: QuestionType) => questionTypeLabels[type] },
    {
      title: '难度', dataIndex: 'difficulty', width: 90,
      render: (difficulty: DifficultyLevel | null) => difficulty ? difficultyLabels[difficulty] : '未设置',
    },
    { title: '来源', dataIndex: 'sourceFileName', width: 160, ellipsis: true, render: (value: string | null) => value || '手工录入' },
    { title: '默认分值', dataIndex: 'defaultScore', width: 100, render: (value: number) => `${value} 分` },
  ];

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (!paper) return null;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/papers')}>返回试卷列表</Button>
        <Tag>{paperStatusLabels[paper.status]}</Tag>
      </Space>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 16, marginBottom: 16 }}>
        <Card>
          <Title level={4}>试卷信息</Title>
          <Form<PaperFormValues> form={form} layout="vertical">
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16 }}>
              <Form.Item name="title" label="试卷名称" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
              <Form.Item name="course" label="课程" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
              <Form.Item name="status" label="状态">
                <Select options={Object.entries(paperStatusLabels).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 16 }}>
              <Form.Item name="description" label="试卷说明"><TextArea rows={2} /></Form.Item>
              <Form.Item name="durationMinutes" label="建议时长（分钟）"><InputNumber min={1} max={1440} style={{ width: '100%' }} /></Form.Item>
            </div>
            <Form.Item name="instructions" label="考试须知"><TextArea rows={2} /></Form.Item>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={savePaper}>保存试卷信息</Button>
          </Form>
        </Card>
        <Card style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Statistic title="试卷总分" value={paper.totalScore} suffix="分" precision={paper.totalScore % 1 ? 1 : 0} />
        </Card>
      </div>

      <Card
        title={`试卷题目（${paper.questions.length}）`}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setSelectorOpen(true)}>从题库选题</Button>}
      >
        <Alert
          type="info"
          showIcon
          message="题目顺序和单题分值会即时保存，总分由系统自动计算。只有已审核题目可以加入试卷。"
          style={{ marginBottom: 16 }}
        />
        <Table<PaperQuestionDetail>
          rowKey="id"
          columns={paperColumns}
          dataSource={paper.questions}
          pagination={false}
        />
      </Card>

      <Modal
        title="从已审核题库选择题目"
        open={selectorOpen}
        width={1000}
        onCancel={() => { setSelectorOpen(false); setSelectedQuestionIds([]); }}
        onOk={addSelectedQuestions}
        okText={`加入试卷${selectedQuestionIds.length ? `（${selectedQuestionIds.length}）` : ''}`}
        confirmLoading={adding}
        okButtonProps={{ disabled: selectedQuestionIds.length === 0 }}
      >
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear placeholder="题型" style={{ width: 130 }} value={questionFilters.type}
            options={Object.entries(questionTypeLabels).map(([value, label]) => ({ value, label }))}
            onChange={(type) => setQuestionFilters((current) => ({ ...current, type }))}
          />
          <Select
            allowClear placeholder="难度" style={{ width: 120 }} value={questionFilters.difficulty}
            options={Object.entries(difficultyLabels).map(([value, label]) => ({ value, label }))}
            onChange={(difficulty) => setQuestionFilters((current) => ({ ...current, difficulty }))}
          />
          <Select
            allowClear showSearch optionFilterProp="label" placeholder="来源文件" style={{ width: 280 }}
            value={questionFilters.sourceFileId}
            options={sources.map((source) => ({
              value: source.id,
              label: `${source.projectTitle} / ${source.filename} (${source.questionCount})`,
            }))}
            onChange={(sourceFileId) => setQuestionFilters((current) => ({ ...current, sourceFileId }))}
          />
          <Button onClick={() => setQuestionFilters({})}>重置</Button>
        </Space>
        <Table<QuestionListItem>
          rowKey="id"
          loading={selectorLoading}
          columns={candidateColumns}
          dataSource={candidates}
          pagination={{ pageSize: 8 }}
          rowSelection={{
            selectedRowKeys: selectedQuestionIds,
            onChange: (keys) => setSelectedQuestionIds(keys.map(Number)),
          }}
        />
      </Modal>
    </div>
  );
};

export default PaperEdit;
