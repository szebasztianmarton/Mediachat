from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Conversation, ConversationMessage

MAX_CONVERSATIONS = 100
MAX_TITLE_LEN = 60


class HistoryService:
    async def list_conversations(self, db: AsyncSession, user_id: str) -> list[Conversation]:
        result = await db.execute(
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(Conversation.updated_at.desc())
            .limit(MAX_CONVERSATIONS)
        )
        return list(result.scalars().all())

    async def get_conversation(
        self, db: AsyncSession, user_id: str, conversation_id: str
    ) -> Conversation | None:
        result = await db.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_conversation(
        self, db: AsyncSession, user_id: str, first_message: str
    ) -> Conversation:
        title = first_message.strip().replace("\n", " ")
        if len(title) > MAX_TITLE_LEN:
            title = title[: MAX_TITLE_LEN - 1] + "…"
        conversation = Conversation(user_id=user_id, title=title or "Új beszélgetés")
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)
        return conversation

    async def delete_conversation(
        self, db: AsyncSession, user_id: str, conversation_id: str
    ) -> bool:
        conversation = await self.get_conversation(db, user_id, conversation_id)
        if conversation is None:
            return False
        await db.execute(
            delete(ConversationMessage).where(ConversationMessage.conversation_id == conversation_id)
        )
        await db.delete(conversation)
        await db.commit()
        return True

    async def list_messages(
        self, db: AsyncSession, conversation_id: str
    ) -> list[ConversationMessage]:
        result = await db.execute(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conversation_id)
            .order_by(ConversationMessage.created_at, ConversationMessage.id)
        )
        return list(result.scalars().all())

    async def add_message(
        self,
        db: AsyncSession,
        conversation: Conversation,
        role: str,
        content: str,
        action: str | None = None,
        payload: str | None = None,
    ) -> None:
        db.add(
            ConversationMessage(
                conversation_id=conversation.id,
                role=role,
                content=content,
                action=action,
                payload=payload,
            )
        )
        conversation.updated_at = datetime.now(UTC)
        await db.commit()
