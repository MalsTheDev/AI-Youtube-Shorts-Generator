from database import init_db, engine, Base
from sqlalchemy import inspect

if __name__ == "__main__":
    print("Initializing database tables...")
    init_db()
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print("Created MySQL tables successfully:", tables)
