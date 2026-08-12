import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Card, Col, Empty, Form, Input, Modal, Row, Select, Space, Tag, Typography, message,
} from 'antd';
import { BookOutlined, EditOutlined, PlusOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import type { CourseDetail, CourseStatus } from '@exam-maker/shared';
import { archiveCourse, createCourse, listCourses, updateCourse, type CourseInput } from '../services/course';

const { Title, Text, Paragraph } = Typography;

const statusMeta: Record<CourseStatus, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  active: { text: '进行中', color: 'green' },
  archived: { text: '已归档', color: 'orange' },
};

function errorText(error: unknown): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '操作失败，请稍后重试';
}

const CourseList: React.FC = () => {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CourseStatus | undefined>();
  const [editing, setEditing] = useState<CourseDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<CourseInput>();

  const load = async () => {
    setLoading(true);
    try { setCourses(await listCourses({ status, search: search || undefined })); }
    catch (error) { message.error(errorText(error)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [status]);

  const showForm = (course?: CourseDetail) => {
    setEditing(course ?? null);
    form.setFieldsValue(course ? {
      name: course.name, code: course.code, semester: course.semester,
      description: course.description, instructorName: course.instructorName, status: course.status,
    } : { status: 'active' });
    setOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) await updateCourse(editing.id, values);
      else await createCourse(values);
      message.success(editing ? '课程已更新' : '课程已创建');
      setOpen(false);
      form.resetFields();
      await load();
    } catch (error) { message.error(errorText(error)); }
    finally { setSaving(false); }
  };

  const confirmArchive = (course: CourseDetail) => Modal.confirm({
    title: `归档课程“${course.name}”？`,
    content: '归档不会删除历史数据，之后可以在编辑课程时重新启用。',
    okText: '确认归档', cancelText: '取消', okButtonProps: { danger: true },
    onOk: async () => {
      try { await archiveCourse(course.id); message.success('课程已归档'); await load(); }
      catch (error) { message.error(errorText(error)); }
    },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <div><Title level={3} style={{ margin: 0 }}>课程</Title><Text type="secondary">以课程组织班级、题库、试卷、考试和成绩。</Text></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => showForm()}>创建课程</Button>
      </div>
      <Space wrap style={{ marginBottom: 20 }}>
        <Input.Search allowClear value={search} onChange={(event) => setSearch(event.target.value)} onSearch={() => load()} prefix={<SearchOutlined />} placeholder="搜索课程名称、代码或学期" style={{ width: 320 }} />
        <Select allowClear placeholder="全部状态" value={status} onChange={setStatus} style={{ width: 140 }} options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.text }))} />
      </Space>
      {courses.length === 0 && !loading ? <Empty description="暂无课程，请先创建课程" /> : (
        <Row gutter={[16, 16]}>
          {courses.map((course) => (
            <Col xs={24} md={12} xl={8} key={course.id}>
              <Card
                loading={loading}
                hoverable
                onClick={() => navigate(`/courses/${course.id}`)}
                actions={[
                  <span key="edit" onClick={(event) => { event.stopPropagation(); showForm(course); }}><EditOutlined /> 编辑</span>,
                  <span key="archive" onClick={(event) => { event.stopPropagation(); if (course.status !== 'archived') confirmArchive(course); }}><StopOutlined /> {course.status === 'archived' ? '已归档' : '归档'}</span>,
                ]}
              >
                <Card.Meta avatar={<BookOutlined style={{ fontSize: 28, color: '#1677ff' }} />} title={<Space>{course.name}<Tag color={statusMeta[course.status].color}>{statusMeta[course.status].text}</Tag></Space>} description={`${course.code || '未设置代码'} · ${course.semester || '未设置学期'}`} />
                <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ minHeight: 44, marginTop: 16 }}>{course.description || '暂无课程说明'}</Paragraph>
                <Space split="·"><Text>{course.summary.classCount} 个班级</Text><Text>{course.summary.questionCount} 道题</Text><Text>{course.summary.paperCount} 份试卷</Text><Text>{course.summary.examCount} 场考试</Text></Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}
      <Modal title={editing ? '编辑课程' : '创建课程'} open={open} onCancel={() => { setOpen(false); form.resetFields(); }} onOk={save} confirmLoading={saving} okText="保存" cancelText="取消">
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="课程名称" rules={[{ required: true, message: '请输入课程名称' }]}><Input maxLength={200} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="code" label="课程代码"><Input maxLength={100} /></Form.Item></Col><Col span={12}><Form.Item name="semester" label="学期"><Input placeholder="例如：2026 秋季" maxLength={100} /></Form.Item></Col></Row>
          <Form.Item name="instructorName" label="授课教师"><Input maxLength={200} /></Form.Item>
          <Form.Item name="description" label="课程说明"><Input.TextArea rows={3} maxLength={5000} showCount /></Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.text }))} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CourseList;
